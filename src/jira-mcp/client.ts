import type { JiraConfig } from "./config.js";

export class JiraClient {
  private readonly authorization: string;

  public constructor(private readonly config: JiraConfig, private readonly fetcher: typeof fetch = fetch) {
    this.authorization = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
  }

  public getIssue(issueKey: string): Promise<Record<string, unknown>> {
    return this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?expand=names,renderedFields`);
  }

  public getCurrentUser(): Promise<Record<string, unknown>> {
    return this.request("/rest/api/3/myself");
  }

  public searchIssues(options: { text?: string; status?: string; maxResults: number }): Promise<Record<string, unknown>> {
    const clauses = [`project in (${this.config.allowedProjectKeys.join(", ")})`];
    if (options.text?.trim()) clauses.push(`text ~ "${escapeJql(options.text.trim())}"`);
    if (options.status?.trim()) clauses.push(`status = "${escapeJql(options.status.trim())}"`);
    return this.request("/rest/api/3/search/jql", {
      method: "POST",
      body: JSON.stringify({
        jql: `${clauses.join(" AND ")} ORDER BY updated DESC`,
        maxResults: options.maxResults,
        fields: ["summary", "description", "status", "priority", "issuetype", "labels", "assignee", "reporter", "parent", "subtasks", "issuelinks", "attachment", "comment"],
      }),
    });
  }

  public async getAttachment(issueKey: string, attachmentId: string, maxBytes: number): Promise<{ contentType: string; data: string }> {
    const issue = await this.getIssue(issueKey);
    const attachments = ((issue.fields as Record<string, unknown> | undefined)?.attachment as Array<Record<string, unknown>> | undefined) ?? [];
    if (!attachments.some((attachment) => String(attachment.id) === attachmentId)) {
      throw new Error(`Attachment ${attachmentId} does not belong to ${issueKey}.`);
    }
    const response = await this.fetcher(`${this.config.baseUrl}/rest/api/3/attachment/content/${encodeURIComponent(attachmentId)}`, {
      headers: { Accept: "*/*", Authorization: this.authorization }, redirect: "follow",
    });
    if (!response.ok) throw new Error(`Jira attachment request failed with HTTP ${response.status} ${response.statusText}`);
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
    if (contentLength > maxBytes) throw new Error(`Attachment ${attachmentId} exceeds the ${maxBytes}-byte limit.`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > maxBytes) throw new Error(`Attachment ${attachmentId} exceeds the ${maxBytes}-byte limit.`);
    return { contentType: response.headers.get("content-type")?.split(";", 1)[0] ?? "application/octet-stream", data: data.toString("base64") };
  }

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: { Accept: "application/json", Authorization: this.authorization, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
    if (!response.ok) throw new Error(`Jira request failed with HTTP ${response.status} ${response.statusText}`);
    return await response.json() as Record<string, unknown>;
  }
}

function escapeJql(value: string): string { return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\""); }
