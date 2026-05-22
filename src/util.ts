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

export function formatPercent(baseline: number, enhanced: number): string {
  if (baseline === 0) return "N/A";
  const change = ((enhanced - baseline) / baseline) * 100;
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

export function log(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  process.stderr.write(`[${timestamp}] ${message}\n`);
}

export function padRight(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

export function padLeft(str: string, width: number): string {
  return str.length >= width ? str : " ".repeat(width - str.length) + str;
}
