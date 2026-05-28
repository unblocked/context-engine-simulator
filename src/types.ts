export interface ClaudeRawOutput {
  type: "result";
  subtype: string;
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  stop_reason: string;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  };
  structured_output?: unknown;
}

export interface AgentResult {
  success: boolean;
  result: string;
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  numTurns: number;
  sessionId: string;
  structuredOutput?: unknown;
  error?: string;
}

export interface AgentInvokeOptions {
  prompt: string;
  cwd: string;
  model: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  timeoutMs: number;
  dangerouslySkipPermissions: boolean;
  disallowedTools?: string[];
  allowedTools?: string[];
  tools?: string;
  jsonSchema?: string;
  env?: Record<string, string>;
  verbose?: boolean;
  tag?: string;
  worktree?: string;
  worktreeBase?: string;
  bannedMcpServers?: string[];
}

export interface EvalResult {
  score: number;
  reasoning: string;
  claudeResult: AgentResult;
}

export interface DiffStats {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface BaselineArm {
  name: string;
  planRun: AgentResult;
  reviewRun: AgentResult;
  implementRun: AgentResult;
  evaluation?: EvalResult;
  diff: string;
  diffStats: DiffStats;
  wallClockMs: number;
}

export interface ContextAttribution {
  category: string;
  gathered: string[];
  used: string[];
  impact: "high" | "medium" | "low" | "none";
}

export interface ContextAnalysis {
  attributions: ContextAttribution[];
  claudeResult: AgentResult;
}

export interface ContextEnhancedArm {
  name: string;
  initialContextRun: AgentResult;
  patternExtractionRun: AgentResult;
  planRun: AgentResult;
  planContextRun: AgentResult;
  reviewRun: AgentResult;
  implementRun: AgentResult;
  evaluation?: EvalResult;
  contextAnalysis?: ContextAnalysis;
  diff: string;
  diffStats: DiffStats;
  wallClockMs: number;
}

export interface ExperimentResult {
  repoPath: string;
  task: string;
  criteria?: string;
  branch: string;
  agent: AgentName;
  model: string;
  baseline: BaselineArm;
  contextEnhanced: ContextEnhancedArm;
  totalCostUsd: number;
  totalDurationMs: number;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export class ContaminationError extends Error {
  constructor(public server: string, public detail: string) {
    super(`Contamination: agent called banned MCP server '${server}' (${detail})`);
    this.name = "ContaminationError";
  }
}

export type AgentName = "claude" | "codex" | "grok" | "cursor";

export interface CliConfig {
  repo: string;
  task: string;
  criteria?: string;
  contextInstructions: string;
  agent: AgentName;
  model: string;
  contextModel: string;
  evalModel: string;
  timeoutSeconds: number;
  contextTimeoutSeconds: number;
  branch: string;
  verbose: boolean;
  keepWorktrees: boolean;
  apiUrl?: string;
  disabledMcpServers: string[];
}
