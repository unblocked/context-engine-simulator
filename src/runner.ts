import type { CliConfig, ClaudeResult, ContextBundle, EvalResult, ExperimentResult } from "./types.js";
import { invokeClaude } from "./claude.js";
import { createWorktree, registerCleanupHandler, removeWorktree, validateGitRepo } from "./worktree.js";
import {
  buildBaselinePrompt,
  buildBaselineSystemSuffix,
  buildContextCollectionPrompt,
  buildContextCollectionSystemSuffix,
  buildContextEnhancedPrompt,
  buildContextEnhancedSystemSuffix,
  buildEvalPrompt,
  buildEvalSystemPrompt,
  EVAL_JSON_SCHEMA,
} from "./prompts.js";
import { printReport, writeJsonReport } from "./report.js";
import { formatCost, formatDuration, log } from "./util.js";

async function runEvaluation(config: CliConfig, agentOutput: string): Promise<EvalResult> {
  const result = await invokeClaude({
    prompt: buildEvalPrompt(config.task, config.criteria, agentOutput),
    systemPrompt: buildEvalSystemPrompt(),
    cwd: config.repo,
    model: config.evalModel,
    dangerouslySkipPermissions: false,
    tools: "",
    jsonSchema: EVAL_JSON_SCHEMA,
    timeoutMs: 120_000,
    maxBudgetUsd: 1.0,
  });

  let parsed: { score: number; reasoning: string };
  try {
    parsed = JSON.parse(result.result);
  } catch {
    const match = result.result.match(/"score"\s*:\s*(\d+)/);
    parsed = {
      score: match ? parseInt(match[1]) : 0,
      reasoning: result.result || "Failed to parse evaluation output",
    };
  }

  return { score: parsed.score, reasoning: parsed.reasoning, claudeResult: result };
}

export async function runExperiment(config: CliConfig): Promise<ExperimentResult> {
  const startTime = Date.now();

  validateGitRepo(config.repo);

  log("Creating worktrees...");
  const baselineWt = createWorktree(config.repo, "baseline", config.branch);
  const contextWt = createWorktree(config.repo, "context", config.branch);
  const unregister = registerCleanupHandler(config.repo, [baselineWt, contextWt]);

  try {
    // Step 1: Baseline run
    log("Step 1/6: Running baseline task...");
    const baselineRun = await invokeClaude({
      prompt: buildBaselinePrompt(config.task),
      appendSystemPrompt: buildBaselineSystemSuffix(config.criteria),
      cwd: baselineWt.path,
      model: config.model,
      dangerouslySkipPermissions: true,
      timeoutMs: config.timeoutSeconds * 1000,
      maxBudgetUsd: config.maxBudgetUsd,
    });
    log(`Baseline complete: ${formatDuration(baselineRun.durationMs)}, ${formatCost(baselineRun.costUsd)}`);
    if (!baselineRun.success) log(`WARNING: Baseline failed — ${baselineRun.error ?? "unknown error"}`);

    // Step 2: Baseline eval
    log("Step 2/6: Evaluating baseline...");
    const baselineEval = await runEvaluation(config, baselineRun.result);
    log(`Baseline score: ${baselineEval.score}/100`);

    // Step 3: Context collection
    log("Step 3/6: Collecting context...");
    const contextRun = await invokeClaude({
      prompt: buildContextCollectionPrompt(config.task),
      appendSystemPrompt: buildContextCollectionSystemSuffix(config.criteria),
      cwd: config.repo,
      model: config.contextModel,
      dangerouslySkipPermissions: true,
      disallowedTools: ["Edit", "Write", "NotebookEdit"],
      timeoutMs: config.timeoutSeconds * 1000,
      maxBudgetUsd: config.maxBudgetUsd,
    });
    log(`Context collected: ${formatDuration(contextRun.durationMs)}, ${formatCost(contextRun.costUsd)}`);
    if (!contextRun.success) log(`WARNING: Context collection failed — ${contextRun.error ?? "unknown error"}`);
    const contextBundle: ContextBundle = { raw: contextRun.result, claudeResult: contextRun };

    // Step 4: Context-enhanced run
    log("Step 4/6: Running context-enhanced task...");
    const contextEnhancedRun = await invokeClaude({
      prompt: buildContextEnhancedPrompt(config.task, contextBundle.raw),
      appendSystemPrompt: buildContextEnhancedSystemSuffix(config.criteria),
      cwd: contextWt.path,
      model: config.model,
      dangerouslySkipPermissions: true,
      timeoutMs: config.timeoutSeconds * 1000,
      maxBudgetUsd: config.maxBudgetUsd,
    });
    log(`Context-enhanced complete: ${formatDuration(contextEnhancedRun.durationMs)}, ${formatCost(contextEnhancedRun.costUsd)}`);
    if (!contextEnhancedRun.success) log(`WARNING: Context-enhanced failed — ${contextEnhancedRun.error ?? "unknown error"}`);

    // Step 5: Context-enhanced eval
    log("Step 5/6: Evaluating context-enhanced...");
    const contextEval = await runEvaluation(config, contextEnhancedRun.result);
    log(`Context-enhanced score: ${contextEval.score}/100`);

    // Step 6: Report
    log("Step 6/6: Generating report...");
    const result: ExperimentResult = {
      repoPath: config.repo,
      task: config.task,
      criteria: config.criteria,
      branch: config.branch,
      model: config.model,
      baseline: { name: "Baseline", taskRun: baselineRun, eval: baselineEval },
      contextCollection: contextBundle,
      contextEnhanced: { name: "Context-Enhanced", taskRun: contextEnhancedRun, eval: contextEval },
      totalCostUsd:
        baselineRun.costUsd +
        baselineEval.claudeResult.costUsd +
        contextRun.costUsd +
        contextEnhancedRun.costUsd +
        contextEval.claudeResult.costUsd,
      totalDurationMs: Date.now() - startTime,
    };

    printReport(result);

    const jsonPath = writeJsonReport(result, process.cwd());
    log(`JSON report written to ${jsonPath}`);
    log(`Total experiment time: ${formatDuration(result.totalDurationMs)}`);
    log(`Total experiment cost: ${formatCost(result.totalCostUsd)}`);

    return result;
  } finally {
    unregister();
    if (!config.keepWorktrees) {
      log("Cleaning up worktrees...");
      removeWorktree(config.repo, baselineWt);
      removeWorktree(config.repo, contextWt);
    } else {
      log(`Keeping worktrees: ${baselineWt.path} and ${contextWt.path}`);
    }
  }
}
