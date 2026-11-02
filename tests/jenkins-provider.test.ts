import { describe, expect, it } from "vitest";
import { JenkinsCiProvider } from "../src/ci/jenkins-provider.js";

describe("JenkinsCiProvider", () => {
  it("normalizes read-only Jenkins build, console, and JUnit data", async () => {
    const requested: string[] = [];
    const fetcher: typeof fetch = async (input) => { const url = String(input); requested.push(url); if (url.endsWith("testReport/api/json")) return new Response(JSON.stringify({ totalCount: 5, failCount: 1, skipCount: 2 }), { status: 200 }); if (url.endsWith("api/json")) return new Response(JSON.stringify({ result: "FAILURE", building: false, timestamp: 0, duration: 1_000 }), { status: 200 }); return new Response("failure log", { status: 200 }); };
    const report = await new JenkinsCiProvider({ baseUrl: "https://jenkins.example.test", username: "qa", apiToken: "token" }, fetcher).getBuild("job/ui/job/main/42");
    expect(report).toMatchObject({ provider: "jenkins", status: "FAILURE", testResults: { total: 5, failed: 1, skipped: 2 }, logs: "failure log" });
    expect(requested).toEqual(["https://jenkins.example.test/job/ui/job/main/42/api/json", "https://jenkins.example.test/job/ui/job/main/42/testReport/api/json", "https://jenkins.example.test/job/ui/job/main/42/consoleText"]);
  });
});
