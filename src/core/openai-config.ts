export function openAIModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-6-luna";
}

export function openAIReasoningEffort(): "low" {
  return "low";
}

export function boundedTokenBudget(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}
