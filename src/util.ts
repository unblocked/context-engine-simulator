export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function log(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  process.stderr.write(`[${timestamp}] ${message}\n`);
}

export interface TokenUsageLike {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// Per-token pricing ($/M tokens) — from cursor.com/docs/models-and-pricing and provider docs
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1.00, cacheWrite: 12.50 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.50, cacheWrite: 6.25 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.10, cacheWrite: 1.25 },
  "gpt-5.4": { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0.75 },
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  "gpt-4.1": { input: 2, output: 8, cacheRead: 0.50, cacheWrite: 2 },
  "o3": { input: 10, output: 40, cacheRead: 2.50, cacheWrite: 10 },
  "auto": { input: 1.25, output: 6, cacheRead: 0.25, cacheWrite: 1.25 },
  "sonnet": { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  "opus": { input: 5, output: 25, cacheRead: 0.50, cacheWrite: 6.25 },
  "haiku": { input: 1, output: 5, cacheRead: 0.10, cacheWrite: 1.25 },
};

const warnedModels = new Set<string>();

function matchPricing(model: string): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  if (PRICING[model]) return PRICING[model];
  const m = model.toLowerCase();
  if (m.includes("fable")) return PRICING["claude-fable-5"];
  if (m.includes("opus")) return PRICING["opus"];
  if (m.includes("haiku")) return PRICING["haiku"];
  if (m.includes("sonnet")) return PRICING["sonnet"];
  if (!warnedModels.has(model)) {
    warnedModels.add(model);
    log(`No pricing for model "${model}" — estimating cost at default (sonnet) rates.`);
  }
  return PRICING["sonnet"];
}

export function estimateCost(model: string, u: TokenUsageLike): number {
  const p = matchPricing(model);
  return (u.inputTokens / 1_000_000) * p.input
    + (u.outputTokens / 1_000_000) * p.output
    + (u.cacheReadTokens / 1_000_000) * p.cacheRead
    + (u.cacheCreationTokens / 1_000_000) * p.cacheWrite;
}

export function padRight(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

export function padLeft(str: string, width: number): string {
  return str.length >= width ? str : " ".repeat(width - str.length) + str;
}
