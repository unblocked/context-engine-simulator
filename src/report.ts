import fs from "node:fs";
import path from "node:path";
import type { ExperimentResult } from "./types.js";
import { estimateTokens, formatCost, formatDuration, formatPercent, formatTokens, padLeft, padRight } from "./util.js";

function line(width: number, char = "─"): string {
  return char.repeat(width);
}

function row(label: string, baseline: string, enhanced: string, delta: string, labelW = 20, colW = 16): string {
  return `  ${padRight(label, labelW)}${padLeft(baseline, colW)}${padLeft(enhanced, colW)}${padLeft(delta, colW)}`;
}

export function printReport(result: ExperimentResult): void {
  const b = result.baseline;
  const c = result.contextEnhanced;
  const bundle = result.contextCollection;

  const baselineArmCost = b.taskRun.costUsd + b.eval.claudeResult.costUsd;
  const contextArmCost = bundle.claudeResult.costUsd + c.taskRun.costUsd + c.eval.claudeResult.costUsd;

  const W = 72;

  const lines: string[] = [
    "",
    "╔" + line(W, "═") + "╗",
    "║" + padRight("  CONTEXT ENGINE SIMULATOR — RESULTS", W) + "║",
    "╠" + line(W, "═") + "╣",
    "║" + padRight(`  Repo:     ${result.repoPath}`, W) + "║",
    "║" + padRight(`  Branch:   ${result.branch}`, W) + "║",
    "║" + padRight(`  Model:    ${result.model}`, W) + "║",
    "║" + padRight(`  Task:     ${result.task.slice(0, 50)}${result.task.length > 50 ? "..." : ""}`, W) + "║",
    "╠" + line(W, "═") + "╣",
    "║" + " ".repeat(W) + "║",
    "║" + padRight(row("", "Baseline", "Context+", "Delta"), W) + "║",
    "║" + padRight("  " + line(64), W) + "║",
    "║" + padRight(
      row(
        "Quality Score",
        `${b.eval.score}/100`,
        `${c.eval.score}/100`,
        `${c.eval.score - b.eval.score >= 0 ? "+" : ""}${c.eval.score - b.eval.score}`
      ), W) + "║",
    "║" + padRight(
      row(
        "Wall-clock Time",
        formatDuration(b.taskRun.durationMs),
        formatDuration(c.taskRun.durationMs),
        formatPercent(b.taskRun.durationMs, c.taskRun.durationMs)
      ), W) + "║",
    "║" + padRight(
      row(
        "Task Cost",
        formatCost(b.taskRun.costUsd),
        formatCost(c.taskRun.costUsd),
        formatPercent(b.taskRun.costUsd, c.taskRun.costUsd)
      ), W) + "║",
    "║" + padRight(
      row(
        "Input Tokens",
        formatTokens(b.taskRun.inputTokens),
        formatTokens(c.taskRun.inputTokens),
        formatPercent(b.taskRun.inputTokens, c.taskRun.inputTokens)
      ), W) + "║",
    "║" + padRight(
      row(
        "Output Tokens",
        formatTokens(b.taskRun.outputTokens),
        formatTokens(c.taskRun.outputTokens),
        formatPercent(b.taskRun.outputTokens, c.taskRun.outputTokens)
      ), W) + "║",
    "║" + padRight(
      row(
        "Turns",
        b.taskRun.numTurns.toString(),
        c.taskRun.numTurns.toString(),
        formatPercent(b.taskRun.numTurns, c.taskRun.numTurns)
      ), W) + "║",
    "║" + " ".repeat(W) + "║",
    "║" + padRight("  Context Collection", W) + "║",
    "║" + padRight("  " + line(64), W) + "║",
    "║" + padRight(`  Time              ${padLeft(formatDuration(bundle.claudeResult.durationMs), 16)}`, W) + "║",
    "║" + padRight(`  Cost              ${padLeft(formatCost(bundle.claudeResult.costUsd), 16)}`, W) + "║",
    "║" + padRight(`  Bundle Size       ${padLeft(`~${formatTokens(estimateTokens(bundle.raw))} tokens`, 16)}`, W) + "║",
    "║" + " ".repeat(W) + "║",
    "║" + padRight("  Total Cost (all phases)", W) + "║",
    "║" + padRight("  " + line(64), W) + "║",
    "║" + padRight(`  Baseline arm      ${padLeft(formatCost(baselineArmCost), 16)}  (task + eval)`, W) + "║",
    "║" + padRight(`  Context arm       ${padLeft(formatCost(contextArmCost), 16)}  (collect + task + eval)`, W) + "║",
    "║" + padRight(`  Experiment total  ${padLeft(formatCost(result.totalCostUsd), 16)}`, W) + "║",
    "║" + " ".repeat(W) + "║",
    buildVerdict(result, baselineArmCost, contextArmCost, W),
    "║" + " ".repeat(W) + "║",
    "╚" + line(W, "═") + "╝",
    "",
  ];

  console.log(lines.join("\n"));
}

function buildVerdict(result: ExperimentResult, baselineCost: number, contextCost: number, W: number): string {
  const scoreDiff = result.contextEnhanced.eval.score - result.baseline.eval.score;
  const timeDiff = formatPercent(result.baseline.taskRun.durationMs, result.contextEnhanced.taskRun.durationMs);
  const costDiff = formatPercent(baselineCost, contextCost);

  let verdict: string;
  if (scoreDiff > 0 && result.contextEnhanced.taskRun.durationMs < result.baseline.taskRun.durationMs) {
    verdict = `Context-enhanced: BETTER quality (+${scoreDiff}) AND FASTER (${timeDiff} time)`;
  } else if (scoreDiff > 0) {
    verdict = `Context-enhanced: BETTER quality (+${scoreDiff}) but SLOWER (${timeDiff} time), cost ${costDiff}`;
  } else if (result.contextEnhanced.taskRun.durationMs < result.baseline.taskRun.durationMs) {
    verdict = `Context-enhanced: FASTER (${timeDiff} time) but SAME/LOWER quality (${scoreDiff})`;
  } else {
    verdict = `Context-enhanced showed no clear advantage (score ${scoreDiff}, time ${timeDiff})`;
  }

  return "║" + padRight(`  Verdict: ${verdict}`, W) + "║";
}

export function writeJsonReport(result: ExperimentResult, outputDir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `experiment-result-${timestamp}.json`;
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
  return filepath;
}
