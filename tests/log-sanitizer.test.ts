import { describe, expect, it } from "vitest";
import { sanitizeCiLog } from "../src/ci/log-sanitizer.js";

describe("sanitizeCiLog", () => {
  it("redacts quoted JSON and key-value secrets", () => {
    const sanitized = sanitizeCiLog('{"token":"super-secret","password": "another-secret","api_key":"escaped\\\"value"}\npassword: "quoted-secret"\nsecret: \'single-quoted-secret\'');

    expect(sanitized).toBe('{"token":"[REDACTED]","password": "[REDACTED]","api_key":"[REDACTED]"}\npassword: "[REDACTED]"\nsecret: \'[REDACTED]\'');
    expect(sanitized).not.toMatch(/super-secret|another-secret|escaped\\"value|quoted-secret|single-quoted-secret/);
  });

  it("redacts common compound secret keys in snake_case and camelCase", () => {
    const sanitized = sanitizeCiLog('{"client_secret":"client-value","accessToken":"access-value","private_key":"private-value"}\naccess_token=second-access\nclientSecret: "second-client"');

    expect(sanitized).toBe('{"client_secret":"[REDACTED]","accessToken":"[REDACTED]","private_key":"[REDACTED]"}\naccess_token=[REDACTED]\nclientSecret: "[REDACTED]"');
    expect(sanitized).not.toMatch(/client-value|access-value|private-value|second-access|second-client/);
  });
});
