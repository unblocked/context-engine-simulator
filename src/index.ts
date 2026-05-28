#!/usr/bin/env node
import { program } from "commander";
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { AgentName, CliConfig } from "./types.js";
import { runExperiment } from "./runner.js";
import { getDefaultBranch } from "./worktree.js";

program
  .name("context-engine-simulator")
  .description("Test whether pre-gathered context helps a coding agent complete tasks faster and cheaper")
  .option("--fixture <path>", "YAML fixture file with experiment config")
  .option("--repo <path>", "Path to target git repository")
  .option("--task <string>", "Task description for the coding agent")
  .option("--task-file <path>", "File containing task description")
  .option("--criteria <string>", "Acceptance criteria for evaluation")
  .option("--criteria-file <path>", "File containing acceptance criteria")
  .option("--context-instructions <string>", "Additional instructions for context collection")
  .option("--context-instructions-file <path>", "File containing context collection instructions")
  .option("--agent <name>", "Agent CLI to use: claude, codex, grok, cursor", "claude")
  .option("--model <model>", "Model for task runs", "sonnet")
  .option("--context-model <model>", "Model for context collection (default: same as --model)")
  .option("--eval-model <model>", "Model for evaluation (default: same as --model)")
  .option("--timeout <seconds>", "Max seconds per task claude invocation", "3600")
  .option("--context-timeout <seconds>", "Max seconds for context collection", "600")
  .option("--branch <name>", "Branch to base worktrees on (default: current HEAD)")
  .option("--api-url <url>", "Custom API base URL for Claude (passed as ANTHROPIC_BASE_URL)")
  .option("--verbose", "Print claude stderr in real-time", false)
  .option("--keep-worktrees", "Don't clean up worktrees after run", false)
  .option("--disable-mcp <servers...>", "MCP servers to disable in agent worktrees (e.g. unblocked)");

program.parse();
const opts = program.opts();

interface FixtureData {
  repo?: string;
  branch?: string;
  task?: string;
  criteria?: string;
  contextInstructions?: string;
  agent?: AgentName;
  model?: string;
  contextModel?: string;
  evalModel?: string;
  timeout?: number;
  contextTimeout?: number;
  apiUrl?: string;
  verbose?: boolean;
  keepWorktrees?: boolean;
  disableMcp?: string[];
}

let fixture: FixtureData = {};
if (opts.fixture) {
  const fixturePath = path.resolve(opts.fixture);
  if (!fs.existsSync(fixturePath)) {
    console.error(`Error: fixture file not found: ${fixturePath}`);
    process.exit(1);
  }
  fixture = parseYaml(fs.readFileSync(fixturePath, "utf-8")) as FixtureData;
}

function resolveText(direct: string | undefined, filePath: string | undefined, fixtureVal: string | undefined, label: string): string {
  if (direct) return direct;
  if (filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.error(`Error: ${label} file not found: ${resolved}`);
      process.exit(1);
    }
    return fs.readFileSync(resolved, "utf-8").trim();
  }
  if (fixtureVal) return fixtureVal.trim();
  console.error(`Error: --${label} or --${label}-file is required (or set in fixture)`);
  process.exit(1);
}

const repoRaw = opts.repo ?? fixture.repo;
if (!repoRaw) {
  console.error("Error: --repo is required (or set in fixture)");
  process.exit(1);
}
const repoPath = path.resolve(repoRaw);
if (!fs.existsSync(repoPath)) {
  console.error(`Error: repo path does not exist: ${repoPath}`);
  process.exit(1);
}

const task = resolveText(opts.task, opts.taskFile, fixture.task, "task");

function resolveOptionalText(direct: string | undefined, filePath: string | undefined, fixtureVal: string | undefined, label: string): string | undefined {
  if (direct) return direct;
  if (filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.error(`Error: ${label} file not found: ${resolved}`);
      process.exit(1);
    }
    return fs.readFileSync(resolved, "utf-8").trim();
  }
  if (fixtureVal) return fixtureVal.trim();
  return undefined;
}

const criteria = resolveOptionalText(opts.criteria, opts.criteriaFile, fixture.criteria, "criteria");
const contextInstructions = opts.contextInstructions
  ?? (opts.contextInstructionsFile ? resolveText(undefined, opts.contextInstructionsFile, undefined, "context-instructions") : undefined)
  ?? fixture.contextInstructions
  ?? "";

function cliOrFixture<T>(optName: string, cliValue: T, fixtureValue: T | undefined, fallback: T): T {
  return program.getOptionValueSource(optName) !== "default" ? cliValue : (fixtureValue ?? fallback);
}

const agent = cliOrFixture("agent", opts.agent, fixture.agent, "claude") as AgentName;
const validAgents: AgentName[] = ["claude", "codex", "grok", "cursor"];
if (!validAgents.includes(agent)) {
  console.error(`Error: unknown agent "${agent}". Valid: ${validAgents.join(", ")}`);
  process.exit(1);
}

const model = cliOrFixture("model", opts.model, fixture.model, "sonnet");

const config: CliConfig = {
  repo: repoPath,
  task,
  criteria,
  contextInstructions,
  agent,
  model,
  contextModel: opts.contextModel ?? fixture.contextModel ?? model,
  evalModel: opts.evalModel ?? fixture.evalModel ?? model,
  timeoutSeconds: cliOrFixture("timeout", parseInt(opts.timeout), fixture.timeout, 3600),
  contextTimeoutSeconds: cliOrFixture("contextTimeout", parseInt(opts.contextTimeout), fixture.contextTimeout, 600),
  branch: opts.branch ?? fixture.branch ?? getDefaultBranch(repoPath),
  apiUrl: opts.apiUrl ?? fixture.apiUrl,
  verbose: opts.verbose || (fixture.verbose ?? false),
  keepWorktrees: opts.keepWorktrees || (fixture.keepWorktrees ?? false),
  disabledMcpServers: opts.disableMcp ?? fixture.disableMcp ?? [],
};

runExperiment(config).catch((err) => {
  console.error("Experiment failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
