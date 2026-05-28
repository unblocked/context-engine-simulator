import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentResult, ExperimentResult } from "./types.js";
import { estimateTokens, formatCost, formatDuration, formatTokens, log, padLeft, padRight } from "./util.js";

const W = 80;

function sep(char = "─"): string {
  return char.repeat(W);
}

function r(content: string): string {
  return "║" + padRight(content, W) + "║";
}

function blank(): string {
  return "║" + " ".repeat(W) + "║";
}

function phaseRow(label: string, run: AgentResult): string {
  return `  ${padRight(label, 22)}${padLeft(formatDuration(run.durationMs), 10)}  ${padLeft(formatCost(run.costUsd), 10)}  ${padLeft(formatTokens(run.outputTokens) + " out", 12)}  ${run.numTurns} turns`;
}

function bundleRow(label: string, run: AgentResult): string {
  return `  ${padRight(label, 22)}${padLeft(formatDuration(run.durationMs), 10)}  ${padLeft(formatCost(run.costUsd), 10)}  ${padLeft("~" + formatTokens(estimateTokens(run.result)) + " bundle", 12)}`;
}

function sumRow(label: string, durationMs: number, costUsd: number): string {
  return `  ${padRight(label, 22)}${padLeft(formatDuration(durationMs), 10)}  ${padLeft(formatCost(costUsd), 10)}`;
}

export function printReport(result: ExperimentResult): void {
  const b = result.baseline;
  const c = result.contextEnhanced;

  const hasEval = !!b.evaluation && !!c.evaluation;

  const bTaskMs = b.planRun.durationMs + b.reviewRun.durationMs + b.implementRun.durationMs;
  const bTaskCost = b.planRun.costUsd + b.reviewRun.costUsd + b.implementRun.costUsd;
  const bTotalCost = bTaskCost + (b.evaluation?.claudeResult.costUsd ?? 0);

  const cTaskMs = c.planRun.durationMs + c.reviewRun.durationMs + c.implementRun.durationMs;
  const cTaskCost = c.planRun.costUsd + c.reviewRun.costUsd + c.implementRun.costUsd;
  const cCtxMs = c.initialContextRun.durationMs + c.patternExtractionRun.durationMs + c.planContextRun.durationMs;
  const cCtxCost = c.initialContextRun.costUsd + c.patternExtractionRun.costUsd + c.planContextRun.costUsd;
  const cTotalCost = cTaskCost + cCtxCost + (c.evaluation?.claudeResult.costUsd ?? 0);

  const lines: string[] = [
    "",
    "╔" + sep("═") + "╗",
    r("  CONTEXT ENGINE SIMULATOR — RESULTS"),
    "╠" + sep("═") + "╣",
    r(`  Repo:     ${result.repoPath}`),
    r(`  Branch:   ${result.branch}`),
    r(`  Agent:    ${result.agent}`),
    r(`  Model:    ${result.model}`),
    r(`  Task:     ${result.task.slice(0, 58)}${result.task.length > 58 ? "..." : ""}`),

    // ── Baseline arm ──
    "╠" + sep("═") + "╣",
    blank(),
    r(`  BASELINE ARM                   Time        Cost     Tokens   Turns`),
    r("  " + sep().slice(0, W - 4)),
    r(phaseRow("1. Plan", b.planRun)),
    r(phaseRow("2. Review", b.reviewRun)),
    r(phaseRow("3. Implement", b.implementRun)),
  ];

  if (b.evaluation) {
    lines.push(r(`  ${padRight("   Eval", 22)}${padLeft(formatDuration(b.evaluation.claudeResult.durationMs), 10)}  ${padLeft(formatCost(b.evaluation.claudeResult.costUsd), 10)}`));
  }

  lines.push(
    r("  " + sep().slice(0, W - 4)),
    r(sumRow("Task (plan+rev+impl)", bTaskMs, bTaskCost)),
    r(sumRow("Arm total", b.wallClockMs, bTotalCost)),
    r(`  ${padRight("Diff", 22)}${padLeft(`${b.diffStats.filesChanged} files +${b.diffStats.linesAdded}/-${b.diffStats.linesRemoved}`, 20)}`),
  );

  if (b.evaluation) {
    lines.push(r(`  ${padRight("Quality", 22)}${padLeft(b.evaluation.score + "/100", 10)}`));
  }

  // ── Context+ arm ──
  lines.push(
    "╠" + sep("═") + "╣",
    blank(),
    r(`  CONTEXT+ ARM                   Time        Cost     Tokens   Turns`),
    r("  " + sep().slice(0, W - 4)),
    r(bundleRow("1. Initial Context", c.initialContextRun)),
    r(phaseRow("2. Pattern Extract", c.patternExtractionRun)),
    r(phaseRow("3. Plan", c.planRun)),
    r(bundleRow("4. Plan Context", c.planContextRun)),
    r(phaseRow("5. Review", c.reviewRun)),
    r(phaseRow("6. Implement", c.implementRun)),
  );

  if (c.evaluation) {
    lines.push(r(`  ${padRight("   Eval", 22)}${padLeft(formatDuration(c.evaluation.claudeResult.durationMs), 10)}  ${padLeft(formatCost(c.evaluation.claudeResult.costUsd), 10)}`));
  }

  lines.push(
    r("  " + sep().slice(0, W - 4)),
    r(sumRow("Task (plan+rev+impl)", cTaskMs, cTaskCost)),
    r(sumRow("Context overhead", cCtxMs, cCtxCost)),
    r(sumRow("Arm total", c.wallClockMs, cTotalCost)),
    r(`  ${padRight("Diff", 22)}${padLeft(`${c.diffStats.filesChanged} files +${c.diffStats.linesAdded}/-${c.diffStats.linesRemoved}`, 20)}`),
  );

  if (c.evaluation) {
    lines.push(r(`  ${padRight("Quality", 22)}${padLeft(c.evaluation.score + "/100", 10)}`));
  }

  // ── Comparison ──
  lines.push(
    "╠" + sep("═") + "╣",
    blank(),
    r("  COMPARISON"),
    r("  " + sep().slice(0, W - 4)),
  );

  if (hasEval) {
    const bScore = b.evaluation!.score;
    const cScore = c.evaluation!.score;
    lines.push(r(`  ${padRight("Quality", 28)}${padLeft(bScore + "/100", 10)}  →  ${padLeft(cScore + "/100", 10)}  (${cScore - bScore >= 0 ? "+" : ""}${cScore - bScore})`));
  }

  lines.push(
    r(`  ${padRight("Task execution time", 28)}${padLeft(formatDuration(bTaskMs), 10)}  →  ${padLeft(formatDuration(cTaskMs), 10)}`),
    r(`  ${padRight("Task execution cost", 28)}${padLeft(formatCost(bTaskCost), 10)}  →  ${padLeft(formatCost(cTaskCost), 10)}`),
    r(`  ${padRight("Context overhead", 28)}${padLeft("—", 10)}       ${padLeft(formatCost(cCtxCost), 10)}  (${formatDuration(cCtxMs)})`),
    r(`  ${padRight("Arm total cost", 28)}${padLeft(formatCost(bTotalCost), 10)}  →  ${padLeft(formatCost(cTotalCost), 10)}`),
    r(`  ${padRight("Experiment total", 28)}${padLeft(formatCost(result.totalCostUsd), 10)}`),
    blank(),
  );

  if (hasEval) {
    lines.push(buildVerdict(result, bTaskMs, cTaskMs));
  }

  lines.push(blank(), "╚" + sep("═") + "╝", "");

  console.log(lines.join("\n"));
}

function buildVerdict(result: ExperimentResult, bTaskMs: number, cTaskMs: number): string {
  const bScore = result.baseline.evaluation?.score ?? 0;
  const cScore = result.contextEnhanced.evaluation?.score ?? 0;
  const scoreDiff = cScore - bScore;
  const faster = cTaskMs < bTaskMs;

  let verdict: string;
  if (scoreDiff > 0 && faster) {
    verdict = `BETTER quality (+${scoreDiff}) AND FASTER task execution`;
  } else if (scoreDiff > 0) {
    verdict = `BETTER quality (+${scoreDiff})`;
  } else if (scoreDiff === 0) {
    verdict = `TIED quality (${bScore}/100)`;
  } else {
    verdict = `WORSE quality (${scoreDiff})`;
  }

  return r(`  Verdict: ${verdict}`);
}

function resolveWorktreePath(worktreePath: string): string {
  try {
    return fs.realpathSync(worktreePath);
  } catch {
    return worktreePath.startsWith("/var/") ? "/private" + worktreePath : worktreePath;
  }
}

function findTranscript(cwdPath: string, sessionId: string): string | null {
  if (!sessionId) return null;
  const encoded = resolveWorktreePath(cwdPath).replace(/\//g, "-");
  const transcriptPath = path.join(os.homedir(), ".claude", "projects", encoded, `${sessionId}.jsonl`);
  return fs.existsSync(transcriptPath) ? transcriptPath : null;
}

function copyTranscript(cwdPath: string, sessionId: string, destPath: string): void {
  const src = findTranscript(cwdPath, sessionId);
  if (src) {
    try {
      fs.copyFileSync(src, destPath);
    } catch (e) {
      log(`Warning: failed to copy transcript ${src}: ${e}`);
    }
  }
}

export interface WriteReportPaths {
  baseline: string;
  context: string;
  repo: string;
}

export function writeJsonReport(result: ExperimentResult, outputDir: string, worktreePaths: WriteReportPaths): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const experimentDir = path.join(outputDir, "results", `experiment-${timestamp}`);
  const baselineDir = path.join(experimentDir, "baseline");
  const contextDir = path.join(experimentDir, "context");

  fs.mkdirSync(baselineDir, { recursive: true });
  fs.mkdirSync(contextDir, { recursive: true });

  fs.writeFileSync(path.join(experimentDir, "result.json"), JSON.stringify(result, null, 2));

  const b = result.baseline;
  copyTranscript(worktreePaths.baseline, b.planRun.sessionId, path.join(baselineDir, "plan.jsonl"));
  copyTranscript(worktreePaths.baseline, b.reviewRun.sessionId, path.join(baselineDir, "review.jsonl"));
  copyTranscript(worktreePaths.baseline, b.implementRun.sessionId, path.join(baselineDir, "implement.jsonl"));
  if (b.evaluation) {
    copyTranscript(worktreePaths.repo, b.evaluation.claudeResult.sessionId, path.join(baselineDir, "eval.jsonl"));
  }

  const c = result.contextEnhanced;
  copyTranscript(worktreePaths.context, c.initialContextRun.sessionId, path.join(contextDir, "initial-context.jsonl"));
  copyTranscript(worktreePaths.context, c.patternExtractionRun.sessionId, path.join(contextDir, "pattern-extraction.jsonl"));
  copyTranscript(worktreePaths.context, c.planRun.sessionId, path.join(contextDir, "plan.jsonl"));
  copyTranscript(worktreePaths.context, c.planContextRun.sessionId, path.join(contextDir, "plan-context.jsonl"));
  copyTranscript(worktreePaths.context, c.reviewRun.sessionId, path.join(contextDir, "review.jsonl"));
  copyTranscript(worktreePaths.context, c.implementRun.sessionId, path.join(contextDir, "implement.jsonl"));
  if (c.evaluation) {
    copyTranscript(worktreePaths.repo, c.evaluation.claudeResult.sessionId, path.join(contextDir, "eval.jsonl"));
  }

  let transcriptCount = 0;
  for (const dir of [baselineDir, contextDir]) {
    transcriptCount += fs.readdirSync(dir).filter(f => f.endsWith(".jsonl")).length;
  }
  log(`Captured ${transcriptCount} transcripts`);

  return experimentDir;
}
