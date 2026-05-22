#!/usr/bin/env node
import { program } from "commander";
import fs from "node:fs";
import path from "node:path";
import type { CliConfig } from "./types.js";
import { runExperiment } from "./runner.js";
import { getDefaultBranch } from "./worktree.js";

program
  .name("context-engine-simulator")
  .description("Test whether pre-gathered context helps a coding agent complete tasks faster and cheaper")
  .requiredOption("--repo <path>", "Path to target git repository")
  .option("--task <string>", "Task description for the coding agent")
  .option("--task-file <path>", "File containing task description")
  .option("--criteria <string>", "Acceptance criteria for evaluation")
  .option("--criteria-file <path>", "File containing acceptance criteria")
  .option("--model <model>", "Model for task runs", "sonnet")
  .option("--context-model <model>", "Model for context collection (default: same as --model)")
  .option("--eval-model <model>", "Model for evaluation (default: same as --model)")
  .option("--timeout <seconds>", "Max seconds per claude invocation", "600")
  .option("--max-budget <usd>", "Max USD per individual claude invocation", "5.00")
  .option("--branch <name>", "Branch to base worktrees on (default: current HEAD)")
  .option("--verbose", "Print claude stderr in real-time", false)
  .option("--keep-worktrees", "Don't clean up worktrees after run", false);

program.parse();
const opts = program.opts();

function resolveText(direct: string | undefined, filePath: string | undefined, label: string): string {
  if (direct) return direct;
  if (filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.error(`Error: ${label} file not found: ${resolved}`);
      process.exit(1);
    }
    return fs.readFileSync(resolved, "utf-8").trim();
  }
  console.error(`Error: --${label} or --${label}-file is required`);
  process.exit(1);
}

const repoPath = path.resolve(opts.repo);
if (!fs.existsSync(repoPath)) {
  console.error(`Error: repo path does not exist: ${repoPath}`);
  process.exit(1);
}

const task = resolveText(opts.task, opts.taskFile, "task");
const criteria = resolveText(opts.criteria, opts.criteriaFile, "criteria");

const config: CliConfig = {
  repo: repoPath,
  task,
  criteria,
  model: opts.model,
  contextModel: opts.contextModel ?? opts.model,
  evalModel: opts.evalModel ?? opts.model,
  timeoutSeconds: parseInt(opts.timeout),
  maxBudgetUsd: parseFloat(opts.maxBudget),
  branch: opts.branch ?? getDefaultBranch(repoPath),
  verbose: opts.verbose,
  keepWorktrees: opts.keepWorktrees,
};

runExperiment(config).catch((err) => {
  console.error("Experiment failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
