# Contributing

Thanks for your interest in improving Context Engine Simulator.

## Development setup

```bash
npm install
```

There's no build step — the tool runs directly via `tsx`.

## Before opening a PR

Please make sure both of these pass:

```bash
npm run typecheck   # tsc --noEmit, strict mode
npm run lint        # eslint src/
```

## Adding a new agent

Each agent lives in its own `src/<agent>.ts` and exports an `invoke<Agent>(opts: AgentInvokeOptions): Promise<AgentResult>` function. To add one:

1. Create `src/<agent>.ts` implementing the `invoke` contract (spawn the CLI, parse its output into an `AgentResult`).
2. Add the agent name to the `AgentName` union in `src/types.ts`.
3. Wire it into `getInvoker()` in `src/runner.ts`.
4. If the agent manages its own git worktrees, update `agentManagesWorktrees()` / `resolveAgentWorktreePath()` in `src/runner.ts`.
5. If the agent supports MCP, honor `opts.bannedMcpServers` so contamination control works.

## Guidelines

- Keep new code consistent with the surrounding style; match the existing patterns.
- Agent wrappers should never throw on a failed run — return a failed `AgentResult` (the contamination case is the one intentional exception, which rejects).
- Don't commit experiment output (`results/`) or local fixtures (`fixtures/`) — both are gitignored.

## Reporting issues

Open an issue with the agent, model, and a minimal fixture that reproduces the problem. Include relevant output from a `--verbose` run.
