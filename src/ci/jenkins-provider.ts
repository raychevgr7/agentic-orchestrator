import type { CiBuildReport, CiBuildStatus, CiProvider } from "./provider.js";
import { sanitizeCiLog } from "./log-sanitizer.js";

export interface JenkinsProviderConfig { baseUrl: string; username: string; apiToken: string; }

export class JenkinsCiProvider implements CiProvider {
  public constructor(private readonly config: JenkinsProviderConfig, private readonly fetcher: typeof fetch = fetch) {}
  public async getBuild(reference: string): Promise<CiBuildReport> {
    const buildUrl = safeBuildUrl(this.config.baseUrl, reference);
    const build = await this.json(buildUrl + "api/json");
    const report = await this.optionalJson(buildUrl + "testReport/api/json");
    const logs = await this.text(buildUrl + "consoleText");
    const status = statusOf(build.result, build.building);
    const timestamp = typeof build.timestamp === "number" ? new Date(build.timestamp).toISOString() : undefined;
    const duration = typeof build.duration === "number" ? build.duration : undefined;
    return { provider: "jenkins", reference, status, buildUrl, startedAt: timestamp, finishedAt: timestamp && duration !== undefined && !build.building ? new Date(new Date(timestamp).getTime() + duration).toISOString() : undefined, logs: sanitizeCiLog(logs), testResults: { total: numberOf(report?.totalCount), failed: numberOf(report?.failCount), skipped: numberOf(report?.skipCount) } };
  }
  private async json(url: string): Promise<Record<string, unknown>> { const response = await this.fetcher(url, { headers: this.headers() }); if (!response.ok) throw new Error(`Jenkins read failed with HTTP ${response.status}.`); return await response.json() as Record<string, unknown>; }
  private async optionalJson(url: string): Promise<Record<string, unknown> | undefined> { const response = await this.fetcher(url, { headers: this.headers() }); if (response.status === 404) return undefined; if (!response.ok) throw new Error(`Jenkins test report read failed with HTTP ${response.status}.`); return await response.json() as Record<string, unknown>; }
  private async text(url: string): Promise<string> { const response = await this.fetcher(url, { headers: this.headers() }); if (!response.ok) throw new Error(`Jenkins console read failed with HTTP ${response.status}.`); return await response.text(); }
  private headers() { return { Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.apiToken}`).toString("base64")}` }; }
}

function safeBuildUrl(baseUrl: string, reference: string): string { if (!/^[A-Za-z0-9_./-]+$/.test(reference) || reference.startsWith("/") || reference.split("/").some(x => !x || x === "." || x === "..")) throw new Error("Jenkins build reference must be a relative job/build path."); return `${baseUrl.replace(/\/+$/, "")}/${reference.replace(/\/?$/, "/")}`; }
function statusOf(result: unknown, building: unknown): CiBuildStatus { if (building === true) return "RUNNING"; return result === "SUCCESS" || result === "FAILURE" || result === "ABORTED" ? result : "UNKNOWN"; }
function numberOf(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0; }
