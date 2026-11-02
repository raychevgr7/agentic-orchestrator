const maximumLogCharacters = 20_000;

export function sanitizeCiLog(value: string): string {
  const excerpt = value.length > maximumLogCharacters ? `[Earlier CI output omitted; last ${maximumLogCharacters} characters retained.]\n${value.slice(-maximumLogCharacters)}` : value;
  return excerpt
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/\b(password|passwd|secret|token|api[_-]?key)\s*([:=])\s*[^\s'\"]+/gi, "$1$2[REDACTED]")
    .replace(/([?&](?:token|api[_-]?key|password|secret)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]");
}
