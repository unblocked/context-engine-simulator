# Context Engine Simulator

A/B test whether pre-gathered organizational context helps AI coding agents complete tasks **faster, cheaper, and better**.

The simulator runs the *same task twice* against a real repository — once as a **baseline** (the agent works from the task description alone) and once **context-enhanced** (the agent first gathers relevant context from the codebase and connected sources, then plans and implements from that briefing). It then scores both results against your acceptance criteria and reports the quality, speed, and cost difference.

It works with multiple coding-agent CLIs — **Claude Code**, **OpenAI Codex**, **Cursor**, and **Grok** — so you can compare how each one benefits from context.

> Powered by [Unblocked](https://getunblocked.com).

---

## How it works

Each run executes two arms **in parallel**, each in its own isolated git worktree so they never interfere:

### Baseline arm (3 steps)
```
Plan ──▶ Review ──▶ Implement ──▶ Evaluate
```
The agent plans, self-reviews the plan, implements it, and the result is scored.

### Context-enhanced arm (6 steps)
```
Gather Context ──▶ Extract Patterns ──▶ Plan ──▶ Gather Plan Context ──▶ Review ──▶ Implement ──▶ Evaluate + Attribute
```
1. **Gather Context** — a read-only researcher agent searches the codebase and any connected MCP sources (issues, PRs, chat, docs) to produce a focused context bundle.
2. **Extract Patterns** — distills the bundle into the codebase's coding-style conventions.
3. **Plan** — plans the task using the bundle as a head start.
4. **Gather Plan Context** — a targeted second pass for risks and style notes specific to the plan.
5. **Review** — cross-checks the plan against the gathered context.
6. **Implement** — writes the code.

Both arms are scored 0–100 by an independent evaluator agent against your acceptance criteria, judging primarily on the **actual code diff**. The context arm additionally produces an **attribution analysis** showing which gathered context actually influenced the implementation.

Results are written as a **terminal table**, a **JSON file**, and a **standalone HTML report**.

---

## Requirements

- **Node.js** ≥ 18
- **git** (the target must be a git repository)
- At least one supported agent CLI installed and on your `PATH`:

  | Agent    | CLI binary | `--agent` value |
  |----------|------------|-----------------|
  | Claude Code | `claude` | `claude` (default) |
  | OpenAI Codex | `codex`  | `codex` |
  | Cursor      | `agent`  | `cursor` |
  | Grok        | `grok`   | `grok` |

Each agent must be authenticated per its own CLI. The simulator shells out to whichever one you select.

---

## Install

```bash
git clone https://github.com/unblocked/context-engine-simulator.git
cd context-engine-simulator
npm install
```

No build step — it runs directly via [`tsx`](https://github.com/privatenumber/tsx).

---

## Usage

### With a fixture (recommended)

Create a YAML fixture (see [`fixture.sample.yaml`](./fixture.sample.yaml)):

```yaml
repo: /path/to/target-repo
branch: main

task: |
  Add a /health endpoint to the API server that returns the service
  name and current timestamp as JSON.

criteria: |
  1. GET /health returns 200 with a JSON body
  2. Response includes "service" and "timestamp" fields
  3. Endpoint is registered following existing router patterns

agent: claude        # claude | codex | cursor | grok
model: sonnet
```

Run it:

```bash
npm start -- --fixture my-experiment.yaml --verbose
```

### With CLI flags

Everything in a fixture can be passed as a flag (flags override fixture values):

```bash
npm start -- \
  --repo /path/to/repo \
  --task "Add a /health endpoint returning service name and timestamp" \
  --criteria "GET /health returns 200 JSON with service and timestamp fields" \
  --agent claude \
  --model opus \
  --verbose
```

### Key options

| Flag | Description | Default |
|------|-------------|---------|
| `--fixture <path>` | YAML fixture file | — |
| `--repo <path>` | Target git repository | *(required)* |
| `--task <string>` / `--task-file <path>` | Task description | *(required)* |
| `--criteria <string>` / `--criteria-file <path>` | Acceptance criteria for scoring | — |
| `--agent <name>` | `claude` \| `codex` \| `cursor` \| `grok` | `claude` |
| `--model <model>` | Model for task runs | `sonnet` |
| `--context-model <model>` | Model for context gathering | same as `--model` |
| `--eval-model <model>` | Model for evaluation | same as `--model` |
| `--timeout <seconds>` | Max seconds per task step | `3600` |
| `--context-timeout <seconds>` | Max seconds per context step | `600` |
| `--branch <name>` | Branch to base worktrees on | current HEAD |
| `--disable-mcp <servers...>` | MCP servers to block in both arms | — |
| `--keep-worktrees` | Keep worktrees after the run for inspection | `false` |
| `--verbose` | Stream agent activity live | `false` |

If `--criteria` is omitted, the evaluation and attribution steps are skipped.

---

## Output

A timestamped directory under `results/` containing:

- **`report.html`** — a self-contained visual report (open in a browser)
- **`result.json`** — full structured results for programmatic analysis

Plus a comparison table printed to the terminal: quality score, wall-clock time, cost, and token counts for each arm and each phase.

---

## Controlling contamination

To measure the *isolated* effect of context gathering, the baseline arm must not have backdoor access to the same context sources. Use `--disable-mcp` (or `disableMcp:` in a fixture) to block specific MCP servers in **both** arms' worktrees; the simulator also detects and aborts a run if a blocked server is called, so contamination can't silently skew the comparison.

```bash
npm start -- --fixture my-experiment.yaml --disable-mcp some-context-server
```

---

## Notes

- Each arm runs in a throwaway git worktree (under your system temp dir, or agent-managed for Claude/Cursor). They're cleaned up automatically unless `--keep-worktrees` is set.
- Cost is computed from each agent's reported token usage where available. Subscription-billed agents (e.g. Grok) report token counts but no per-token price, so their cost shows as `$0`.
- The tool never commits or pushes; it only reads the target repo and works inside isolated worktrees.

---

## License

[MIT](./LICENSE) © Unblocked
