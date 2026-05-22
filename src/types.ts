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
}

export interface ClaudeResult {
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
  error?: string;
}

export interface ClaudeInvokeOptions {
  prompt: string;
  cwd: string;
  model: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  timeoutMs: number;
  maxBudgetUsd: number;
  dangerouslySkipPermissions: boolean;
  disallowedTools?: string[];
  allowedTools?: string[];
  tools?: string;
  jsonSchema?: string;
}

export interface EvalResult {
  score: number;
  reasoning: string;
  claudeResult: ClaudeResult;
}

export interface ContextBundle {
  raw: string;
  claudeResult: ClaudeResult;
}

export interface ExperimentArm {
  name: string;
  taskRun: ClaudeResult;
  eval: EvalResult;
}

export interface ExperimentResult {
  repoPath: string;
  task: string;
  criteria: string;
  branch: string;
  model: string;
  baseline: ExperimentArm;
  contextCollection: ContextBundle;
  contextEnhanced: ExperimentArm;
  totalCostUsd: number;
  totalDurationMs: number;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
}

export interface CliConfig {
  repo: string;
  task: string;
  criteria: string;
  model: string;
  contextModel: string;
  evalModel: string;
  timeoutSeconds: number;
  maxBudgetUsd: number;
  branch: string;
  verbose: boolean;
  keepWorktrees: boolean;
}
