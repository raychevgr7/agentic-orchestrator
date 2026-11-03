const maximumLogCharacters = 20_000;
const sensitiveKey = "(?:password|passwd|secret|token|api[_-]?key|client[_-]?secret|access[_-]?token|private[_-]?key)";

export function sanitizeCiLog(value: string): string {
  const excerpt = value.length > maximumLogCharacters ? `[Earlier CI output omitted; last ${maximumLogCharacters} characters retained.]\n${value.slice(-maximumLogCharacters)}` : value;
  return excerpt
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(new RegExp(`("${sensitiveKey}"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, "gi"), "$1\"[REDACTED]\"")
    .replace(new RegExp(`(\\b${sensitiveKey}\\s*[:=]\\s*)"(?:\\\\.|[^"\\\\])*"`, "gi"), "$1\"[REDACTED]\"")
    .replace(new RegExp(`(\\b${sensitiveKey}\\s*[:=]\\s*)'(?:\\\\.|[^'\\\\])*'`, "gi"), "$1'[REDACTED]'")
    .replace(new RegExp(`\\b(${sensitiveKey})\\s*([:=])\\s*[^\\s'"]+`, "gi"), "$1$2[REDACTED]")
    .replace(new RegExp(`([?&]${sensitiveKey}=)[^&#\\s]+`, "gi"), "$1[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]");
}
