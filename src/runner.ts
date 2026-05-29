import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import type { AgentInvokeOptions, AgentName, AgentResult, BaselineArm, CliConfig, ContextAnalysis, ContextAttribution, ContextEnhancedArm, DiffStats, EvalResult, ExperimentResult } from "./types.js";
import { invokeClaude } from "./claude.js";
import { invokeCodex } from "./codex.js";
import { invokeCursor } from "./cursor.js";
import { invokeGrok } from "./grok.js";
import { createWorktree, registerCleanupHandler, removeWorktree, validateGitRepo } from "./worktree.js";
import {
  buildBaselinePlanPrompt,
  buildBaselineReviewPrompt,
  buildBaselineReviewSystemSuffix,
  buildContextCollectionPrompt,
  buildContextCollectionSystemSuffix,
  buildContextPlanPrompt,
  buildContextReviewPrompt,
  buildContextReviewSystemSuffix,
  buildEvalPrompt,
  buildEvalSystemPrompt,
  buildImplementPrompt,
  buildImplementSystemSuffix,
  buildPatternExtractionPrompt,
  buildPatternExtractionSystemPrompt,
  buildPlanContextPrompt,
  buildPlanContextSystemSuffix,
  buildPlanSystemSuffix,
  EVAL_JSON_SCHEMA,
  buildContextAttributionSystemPrompt,
  buildContextAttributionPrompt,
  CONTEXT_ATTRIBUTION_JSON_SCHEMA,
} from "./prompts.js";
import { writeHtmlReport } from "./html-report.js";
import { printReport, writeJsonReport } from "./report.js";
import { formatCost, formatDuration, log } from "./util.js";

type Invoker = (opts: AgentInvokeOptions) => Promise<AgentResult>;

function getInvoker(agent: AgentName): Invoker {
  switch (agent) {
    case "claude": return invokeClaude;
    case "codex": return invokeCodex;
    case "grok": return invokeGrok;
    case "cursor": return invokeCursor;
  }
}

const READ_ONLY_BLOCKED = ["Edit", "Write", "NotebookEdit", "Agent"];

function buildAgentEnv(config: CliConfig): Record<string, string> | undefined {
  if (!config.apiUrl) return undefined;
  if (config.agent === "claude") return { ANTHROPIC_BASE_URL: config.apiUrl };
  return undefined;
}

function agentManagesWorktrees(agent: AgentName): boolean {
  return agent === "cursor" || agent === "claude";
}

function resolveAgentWorktreePath(agent: AgentName, repo: string, wtName: string): string {
  if (agent === "cursor") {
    return path.join(os.homedir(), ".cursor", "worktrees", path.basename(repo), wtName);
  }
  if (agent === "claude") {
    return path.join(repo, ".claude", "worktrees", wtName);
  }
  throw new Error(`Agent ${agent} does not manage worktrees`);
}

function removeAgentWorktree(agent: AgentName, repo: string, wtName: string): void {
  const wtPath = resolveAgentWorktreePath(agent, repo, wtName);
  try {
    execSync(`git worktree remove --force "${wtPath}"`, { cwd: repo, stdio: "pipe" });
  } catch {
    try { execSync("git worktree prune", { cwd: repo, stdio: "pipe" }); } catch { /* best effort */ }
  }
}

function generateWorktreeName(label: string): string {
  return `ces-${label}-${randomBytes(4).toString("hex")}`;
}

function encodeCursorProjectPath(p: string): string {
  return p.replace(/\//g, "-").replace(/\./g, "").replace(/^-/, "");
}

function prepareCursorWorktree(repo: string, wtName: string, disabledServers: string[]): void {
  const projectsBase = path.join(os.homedir(), ".cursor", "projects");
  const srcDir = path.join(projectsBase, encodeCursorProjectPath(repo));
  const wtDir = path.join(projectsBase, encodeCursorProjectPath(resolveAgentWorktreePath("cursor", repo, wtName)));
  fs.mkdirSync(wtDir, { recursive: true });

  for (const file of ["mcp-auth.json", "mcp-approvals.json"]) {
    const src = path.join(srcDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(wtDir, file));
    }
  }

  if (disabledServers.length) {
    fs.writeFileSync(path.join(wtDir, "mcp-disabled.json"), JSON.stringify(disabledServers));

    for (const dir of [srcDir, wtDir]) {
      const approvalsPath = path.join(dir, "mcp-approvals.json");
      try {
        const approvals = JSON.parse(fs.readFileSync(approvalsPath, "utf-8")) as string[];
        const filtered = approvals.filter(
          (a) => !disabledServers.some((s) => a.toLowerCase().includes(s.toLowerCase())),
        );
        if (filtered.length !== approvals.length) {
          fs.writeFileSync(approvalsPath, JSON.stringify(filtered, null, 2));
        }
      } catch { /* no approvals file */ }
    }
    log(`Disabled MCP servers for ${wtName}: ${disabledServers.join(", ")}`);
  }

  log(`Prepared cursor worktree config for ${wtName}`);
}

const DIFF_MAX_BUFFER = 64 * 1024 * 1024;

function git(worktreePath: string, args: string[]): string {
  // execFileSync passes args directly to git without a shell, so filenames
  // containing spaces, quotes, or shell metacharacters are handled safely.
  return execFileSync("git", args, {
    cwd: worktreePath,
    stdio: "pipe",
    maxBuffer: DIFF_MAX_BUFFER,
  }).toString();
}

function captureWorktreeDiff(worktreePath: string): string {
  try {
    let diff = git(worktreePath, ["diff", "--staged"]) + git(worktreePath, ["diff"]);

    // Null-delimited so filenames with spaces/newlines are parsed correctly.
    const untracked = git(worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"])
      .split("\0")
      .filter(Boolean);

    for (const file of untracked) {
      try {
        diff += git(worktreePath, ["diff", "--no-index", "--", "/dev/null", file]);
      } catch (e: unknown) {
        // git diff --no-index exits non-zero when files differ; its stdout is the diff.
        const err = e as { stdout?: Buffer };
        if (err.stdout) diff += err.stdout.toString();
      }
    }

    return diff || "(no file changes detected)";
  } catch {
    return "(failed to capture diff)";
  }
}

function parseDiffStats(diff: string): DiffStats {
  let filesChanged = 0;
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git") || line.startsWith("diff --no-index")) filesChanged++;
    else if (line.startsWith("+") && !line.startsWith("+++")) linesAdded++;
    else if (line.startsWith("-") && !line.startsWith("---")) linesRemoved++;
  }

  return { filesChanged, linesAdded, linesRemoved };
}

async function runEvaluation(invoke: Invoker, config: CliConfig, agentOutput: string, codeDiff: string, tag: string): Promise<EvalResult> {
  const result = await invoke({
    prompt: buildEvalPrompt(config.task, config.criteria!, agentOutput, codeDiff),
    systemPrompt: buildEvalSystemPrompt(),
    cwd: config.repo,
    model: config.evalModel,
    dangerouslySkipPermissions: false,
    tools: "",
    jsonSchema: EVAL_JSON_SCHEMA,
    timeoutMs: 120_000,
    env: buildAgentEnv(config),
    verbose: config.verbose,
    tag,
  });

  let parsed: { score: number; reasoning: string };

  const so = result.structuredOutput as { score?: number; reasoning?: string } | undefined;
  if (so && typeof so.score === "number") {
    parsed = { score: so.score, reasoning: so.reasoning ?? "" };
  } else {
    try {
      parsed = JSON.parse(result.result);
    } catch {
      const jsonMatch = result.result.match(/"score"\s*:\s*(\d+)/);
      const labelMatch = result.result.match(/[Ss]core[:\s*]*\**(\d{1,3})\**/);
      const leadingMatch = result.result.match(/^(\d{1,3})[\s.,:\-/]/);
      const anyNumberMatch = result.result.match(/\b(\d{1,3})\b/);
      const scoreStr = jsonMatch?.[1] ?? labelMatch?.[1] ?? leadingMatch?.[1] ?? anyNumberMatch?.[1];
      parsed = {
        score: scoreStr ? Math.min(parseInt(scoreStr), 100) : 0,
        reasoning: result.result || "Failed to parse evaluation output",
      };
    }
  }

  return { score: parsed.score, reasoning: parsed.reasoning, claudeResult: result };
}

async function runContextAttribution(
  invoke: Invoker,
  config: CliConfig,
  initialContext: string,
  planContext: string,
  codeDiff: string,
): Promise<ContextAnalysis> {
  const result = await invoke({
    prompt: buildContextAttributionPrompt(initialContext, planContext, codeDiff),
    systemPrompt: buildContextAttributionSystemPrompt(),
    cwd: config.repo,
    model: config.evalModel,
    dangerouslySkipPermissions: false,
    tools: "",
    jsonSchema: CONTEXT_ATTRIBUTION_JSON_SCHEMA,
    timeoutMs: 120_000,
    env: buildAgentEnv(config),
    verbose: config.verbose,
    tag: "ctx:attr",
  });

  let attributions: ContextAttribution[] = [];

  const so = result.structuredOutput as { attributions?: ContextAttribution[] } | undefined;
  if (so?.attributions) {
    attributions = so.attributions;
  } else {
    try {
      const parsed = JSON.parse(result.result);
      attributions = Array.isArray(parsed) ? parsed : (parsed.attributions ?? []);
    } catch {
      attributions = [];
    }
  }

  return { attributions, claudeResult: result };
}

interface WorktreeSetup {
  cwd: string;
  worktree?: string;
  worktreeBase?: string;
}

async function runBaselineChain(invoke: Invoker, config: CliConfig, wt: WorktreeSetup): Promise<BaselineArm> {
  const chainStart = Date.now();

  // 1. Plan — first invocation gets worktree flag (creates it for cursor/claude)
  log("[baseline] 1/3 Plan...");
  const plan = await invoke({
    prompt: buildBaselinePlanPrompt(config.task),
    appendSystemPrompt: buildPlanSystemSuffix(false),
    cwd: wt.cwd,
    model: config.model,
    dangerouslySkipPermissions: true,
    disallowedTools: READ_ONLY_BLOCKED,
    timeoutMs: config.timeoutSeconds * 1000,
    env: buildAgentEnv(config),
    verbose: config.verbose,
    tag: "base:plan",
    worktree: wt.worktree,
    worktreeBase: wt.worktreeBase,
    bannedMcpServers: config.disabledMcpServers,
  });
  log(`[baseline] Plan: ${formatDuration(plan.durationMs)}, ${formatCost(plan.costUsd)}`);

  // After first invocation, resolve worktree path for subsequent calls
  const wtPath = wt.worktree
    ? resolveAgentWorktreePath(config.agent, config.repo, wt.worktree)
    : wt.cwd;

  // 2. Review (input: plan → output: adjusted plan)
  log("[baseline] 2/3 Review...");
  const review = await invoke({
    prompt: buildBaselineReviewPrompt(config.task, plan.result),
    appendSystemPrompt: buildBaselineReviewSystemSuffix(),
    cwd: wtPath,
    model: config.model,
    dangerouslySkipPermissions: true,
    disallowedTools: READ_ONLY_BLOCKED,
    timeoutMs: config.timeoutSeconds * 1000,
    env: buildAgentEnv(config),
    verbose: config.verbose,
    tag: "base:review",
    bannedMcpServers: config.disabledMcpServers,
  });
  log(`[baseline] Review: ${formatDuration(review.durationMs)}, ${formatCost(review.costUsd)}`);

  // 3. Implement (input: reviewed/adjusted plan)
  log("[baseline] 3/3 Implement...");
  const implement = await invoke({
    prompt: buildImplementPrompt(review.result),
    appendSystemPrompt: buildImplementSystemSuffix(),
    cwd: wtPath,
    model: config.model,
    dangerouslySkipPermissions: true,
    timeoutMs: config.timeoutSeconds * 1000,
    env: buildAgentEnv(config),
    verbose: config.verbose,
    tag: "base:impl",
    bannedMcpServers: config.disabledMcpServers,
  });
  log(`[baseline] Implement: ${formatDuration(implement.durationMs)}, ${formatCost(implement.costUsd)}`);

  const diff = captureWorktreeDiff(wtPath);
  const diffStats = parseDiffStats(diff);
  log(`[baseline] Diff: ${diffStats.filesChanged} files, +${diffStats.linesAdded}/-${diffStats.linesRemoved}`);

  let evaluation: EvalResult | undefined;
  if (config.criteria) {
    log("[baseline] Eval...");
    evaluation = await runEvaluation(invoke, config, implement.result, diff, "base:eval");
    log(`[baseline] Score: ${evaluation.score}/100`);
  }

  return { name: "Baseline", planRun: plan, reviewRun: review, implementRun: implement, evaluation, diff, diffStats, wallClockMs: Date.now() - chainStart };
}

async function runContextChain(invoke: Invoker, config: CliConfig, wt: WorktreeSetup): Promise<ContextEnhancedArm> {
  const chainStart = Date.now();

  // 1. Initial context collection — first invocation gets worktree flag
  log("[context] 1/6 Initial context...");
  const initialCtx = await invoke({
    prompt: buildContextCollectionPrompt(config.task, config.contextInstructions),
    appendSystemPrompt: buildContextCollectionSystemSuffix(),
    cwd: wt.cwd,
    model: config.contextModel,
    dangerouslySkipPermissions: true,
    disallowedTools: READ_ONLY_BLOCKED,
    timeoutMs: config.contextTimeoutSeconds * 1000,
    env: buildAgentEnv(config),
    verbose: config.verbose,
    tag: "ctx:gather",
    worktree: wt.worktree,
    worktreeBase: wt.worktreeBase,
    bannedMcpServers: config.disabledMcpServers,
  });
  log(`[context] Initial context: ${formatDuration(initialCtx.durationMs)}, ${formatCost(initialCtx.costUsd)}`);

  const wtPath = wt.worktree
    ? resolveAgentWorktreePath(config.agent, config.repo, wt.worktree)
    : wt.cwd;

  // 2. Pattern extraction (no tools — reads context bundle, extracts concise pattern checklist)
  log("[context] 2/6 Pattern extraction...");
  const patterns = await invoke({
    prompt: buildPatternExtractionPrompt(initialCtx.result),
    systemPrompt: buildPatternExtractionSystemPrompt(),
    cwd: wtPath,
    model: config.contextModel,
    dangerouslySkipPermissions: false,
    tools: "",
    timeoutMs: 120_000,
    env: buildAgentEnv(config),
    verbose: config.verbose,
    tag: "ctx:patterns",
  });
  log(`[context] Pattern extraction: ${formatDuration(patterns.durationMs)}, ${formatCost(patterns.costUsd)}`);

  // 3. Plan (input: mandatory patterns + context bundle)
  log("[context] 3/6 Plan...");
  const plan = await invoke({
    prompt: buildContextPlanPrompt(config.task, initialCtx.result, patterns.result),
    appendSystemPrompt: buildPlanSystemSuffix(true),
    cwd: wtPath,
    model: config.model,
    dangerouslySkipPermissions: true,
    disallowedTools: READ_ONLY_BLOCKED,
    timeoutMs: config.timeoutSeconds * 1000,
    env: buildAgentEnv(config),
    verbose: config.verbose,
    tag: "ctx:plan",
    bannedMcpServers: config.disabledMcpServers,
  });
  log(`[context] Plan: ${formatDuration(plan.durationMs)}, ${formatCost(plan.costUsd)}`);

  // 4. Plan-targeted context collection
  log("[context] 4/6 Plan context...");
  const planCtx = await invoke({
    prompt: buildPlanContextPrompt(config.task, plan.result, initialCtx.result, config.contextInstructions),
    appendSystemPrompt: buildPlanContextSystemSuffix(),
    cwd: wtPath,
    model: config.contextModel,
    dangerouslySkipPermissions: true,
    disallowedTools: READ_ONLY_BLOCKED,
    timeoutMs: config.contextTimeoutSeconds * 1000,
    env: buildAgentEnv(config),
    verbose: config.verbose,
    tag: "ctx:planctx",
    bannedMcpServers: config.disabledMcpServers,
  });
  log(`[context] Plan context: ${formatDuration(planCtx.durationMs)}, ${formatCost(planCtx.costUsd)}`);

  // 5. Review (input: plan + plan context + mandatory patterns → output: adjusted plan)
  log("[context] 5/6 Review...");
  const review = await invoke({
    prompt: buildContextReviewPrompt(config.task, plan.result, planCtx.result, patterns.result),
    appendSystemPrompt: buildContextReviewSystemSuffix(),
    cwd: wtPath,
    model: config.model,
    dangerouslySkipPermissions: true,
    disallowedTools: READ_ONLY_BLOCKED,
    timeoutMs: config.timeoutSeconds * 1000,
    env: buildAgentEnv(config),
    verbose: config.verbose,
    tag: "ctx:review",
    bannedMcpServers: config.disabledMcpServers,
  });
  log(`[context] Review: ${formatDuration(review.durationMs)}, ${formatCost(review.costUsd)}`);

  // 6. Implement (input: reviewed/adjusted plan)
  log("[context] 6/6 Implement...");
  const implement = await invoke({
    prompt: buildImplementPrompt(review.result),
    appendSystemPrompt: buildImplementSystemSuffix(),
    cwd: wtPath,
    model: config.model,
    dangerouslySkipPermissions: true,
    timeoutMs: config.timeoutSeconds * 1000,
    env: buildAgentEnv(config),
    verbose: config.verbose,
    tag: "ctx:impl",
    bannedMcpServers: config.disabledMcpServers,
  });
  log(`[context] Implement: ${formatDuration(implement.durationMs)}, ${formatCost(implement.costUsd)}`);

  const diff = captureWorktreeDiff(wtPath);
  const diffStats = parseDiffStats(diff);
  log(`[context] Diff: ${diffStats.filesChanged} files, +${diffStats.linesAdded}/-${diffStats.linesRemoved}`);

  let evaluation: EvalResult | undefined;
  let contextAnalysis: ContextAnalysis | undefined;
  if (config.criteria) {
    log("[context] Eval...");
    evaluation = await runEvaluation(invoke, config, implement.result, diff, "ctx:eval");
    log(`[context] Score: ${evaluation.score}/100`);

    log("[context] Analyzing context attribution...");
    contextAnalysis = await runContextAttribution(invoke, config, initialCtx.result, planCtx.result, diff);
    const highImpact = contextAnalysis.attributions.filter(a => a.impact === "high").length;
    log(`[context] Attribution: ${contextAnalysis.attributions.length} sources, ${highImpact} high-impact`);
  }

  return {
    name: "Context-Enhanced",
    initialContextRun: initialCtx,
    patternExtractionRun: patterns,
    planRun: plan,
    planContextRun: planCtx,
    reviewRun: review,
    implementRun: implement,
    evaluation,
    contextAnalysis,
    diff,
    diffStats,
    wallClockMs: Date.now() - chainStart,
  };
}

export async function runExperiment(config: CliConfig): Promise<ExperimentResult> {
  const startTime = Date.now();

  validateGitRepo(config.repo);

  const invoke = getInvoker(config.agent);
  const nativeWt = agentManagesWorktrees(config.agent);

  let baselineWtSetup: WorktreeSetup;
  let contextWtSetup: WorktreeSetup;
  let baselineWtName: string | undefined;
  let contextWtName: string | undefined;
  let selfManagedWts: { path: string; branch: string }[] = [];
  let unregister: (() => void) | undefined;

  if (nativeWt) {
    baselineWtName = generateWorktreeName("baseline");
    contextWtName = generateWorktreeName("context");
    baselineWtSetup = { cwd: config.repo, worktree: baselineWtName, worktreeBase: config.branch };
    contextWtSetup = { cwd: config.repo, worktree: contextWtName, worktreeBase: config.branch };
    log(`Using ${config.agent}-managed worktrees: ${baselineWtName}, ${contextWtName}`);
    if (config.agent === "cursor") {
      prepareCursorWorktree(config.repo, baselineWtName, config.disabledMcpServers);
      prepareCursorWorktree(config.repo, contextWtName, config.disabledMcpServers);
    }
  } else {
    log("Creating worktrees...");
    const baselineWt = createWorktree(config.repo, "baseline", config.branch);
    const contextWt = createWorktree(config.repo, "context", config.branch);
    selfManagedWts = [baselineWt, contextWt];
    unregister = registerCleanupHandler(config.repo, selfManagedWts);
    baselineWtSetup = { cwd: baselineWt.path };
    contextWtSetup = { cwd: contextWt.path };
  }

  try {
    log(`Running baseline and context chains in parallel (agent: ${config.agent})...`);
    // allSettled (not all): if one arm rejects (e.g. contamination), we still wait
    // for the other to finish before the `finally` cleanup tears down its worktree,
    // so we never orphan a live agent process or delete files out from under it.
    const [baselineResult, contextResult] = await Promise.allSettled([
      runBaselineChain(invoke, config, baselineWtSetup),
      runContextChain(invoke, config, contextWtSetup),
    ]);
    if (baselineResult.status === "rejected") throw baselineResult.reason;
    if (contextResult.status === "rejected") throw contextResult.reason;
    const baseline = baselineResult.value;
    const contextEnhanced = contextResult.value;

    log("Generating report...");

    const baselineCost =
      baseline.planRun.costUsd + baseline.reviewRun.costUsd +
      baseline.implementRun.costUsd +
      (baseline.evaluation?.claudeResult.costUsd ?? 0);

    const c = contextEnhanced;
    const contextCost =
      c.initialContextRun.costUsd + c.patternExtractionRun.costUsd +
      c.planRun.costUsd + c.planContextRun.costUsd +
      c.reviewRun.costUsd + c.implementRun.costUsd +
      (c.evaluation?.claudeResult.costUsd ?? 0) +
      (c.contextAnalysis?.claudeResult.costUsd ?? 0);

    const result: ExperimentResult = {
      repoPath: config.repo,
      task: config.task,
      criteria: config.criteria,
      branch: config.branch,
      agent: config.agent,
      model: config.model,
      baseline,
      contextEnhanced,
      totalCostUsd: baselineCost + contextCost,
      totalDurationMs: Date.now() - startTime,
    };

    printReport(result);

    const baselineWtPath = nativeWt
      ? resolveAgentWorktreePath(config.agent, config.repo, baselineWtName!)
      : selfManagedWts[0].path;
    const contextWtPath = nativeWt
      ? resolveAgentWorktreePath(config.agent, config.repo, contextWtName!)
      : selfManagedWts[1].path;

    const resultDir = writeJsonReport(result, process.cwd(), {
      baseline: baselineWtPath,
      context: contextWtPath,
      repo: config.repo,
    });
    const htmlPath = writeHtmlReport(result, resultDir);
    log(`Results written to ${resultDir}`);
    log(`HTML report: ${htmlPath}`);
    log(`Total experiment time: ${formatDuration(result.totalDurationMs)}`);
    log(`Total experiment cost: ${formatCost(result.totalCostUsd)}`);

    return result;
  } finally {
    unregister?.();
    if (!config.keepWorktrees) {
      log("Cleaning up worktrees...");
      if (nativeWt) {
        removeAgentWorktree(config.agent, config.repo, baselineWtName!);
        removeAgentWorktree(config.agent, config.repo, contextWtName!);
      } else {
        for (const wt of selfManagedWts) {
          removeWorktree(config.repo, wt);
        }
      }
    } else {
      const bPath = nativeWt ? resolveAgentWorktreePath(config.agent, config.repo, baselineWtName!) : selfManagedWts[0].path;
      const cPath = nativeWt ? resolveAgentWorktreePath(config.agent, config.repo, contextWtName!) : selfManagedWts[1].path;
      log(`Keeping worktrees: ${bPath}, ${cPath}`);
    }
  }
}
