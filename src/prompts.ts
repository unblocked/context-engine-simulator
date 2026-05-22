export function buildBaselineSystemSuffix(criteria: string): string {
  return `You are completing a coding task. Work autonomously — do not ask questions.
Complete the task fully. When done, output a brief summary of what you changed.

ACCEPTANCE CRITERIA (your work will be evaluated against these):
${criteria}`;
}

export function buildBaselinePrompt(task: string): string {
  return task;
}

export function buildEvalSystemPrompt(): string {
  return `You are an impartial code evaluator. You will be given:
1. A TASK that was assigned to a coding agent
2. ACCEPTANCE CRITERIA the output must satisfy
3. The AGENT OUTPUT (what the agent said it did)

Score the output 0-100 where:
- 0 = nothing useful was done
- 25 = some progress but major criteria unmet
- 50 = partial completion, some criteria met
- 75 = mostly complete, minor issues
- 100 = all acceptance criteria fully satisfied

You MUST respond with EXACTLY this JSON format and nothing else:
{"score": <number>, "reasoning": "<one paragraph explanation>"}`;
}

export function buildEvalPrompt(task: string, criteria: string, agentOutput: string): string {
  return `TASK:
${task}

ACCEPTANCE CRITERIA:
${criteria}

AGENT OUTPUT:
${agentOutput}`;
}

export const EVAL_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 },
    reasoning: { type: "string" },
  },
  required: ["score", "reasoning"],
});

export function buildContextCollectionSystemSuffix(criteria: string): string {
  return `You are a context researcher preparing a briefing for a coding agent who will work on a task.

YOUR MISSION: Exhaustively search this codebase and any available MCP tools (Notion, Slack, Unblocked, etc.) to gather ALL context that would help another agent complete the task efficiently.

SEARCH STRATEGY — do ALL of these:
1. Read the project README, CLAUDE.md, CONTRIBUTING.md, and any documentation files
2. Understand the project structure (package.json, directory layout, build system)
3. Find files most relevant to the task using grep and file search
4. Read the relevant source files to understand current implementation
5. Check test files to understand expected behavior and testing patterns
6. Look at recent git history for related changes
7. Search MCP tools (if available) for related PRs, discussions, decisions, docs
8. Identify coding patterns, conventions, and architectural decisions

OUTPUT FORMAT: Produce a context bundle in Markdown with these sections:

# Context Bundle

## Project Overview
<Brief description of the project, tech stack, build system>

## Relevant Architecture
<How the relevant parts of the codebase are structured, key abstractions>

## Key Files
<List of files most relevant to the task, with brief descriptions of what each contains>

## Relevant Code Patterns
<Coding conventions, patterns, and idioms used in this codebase>

## Related History
<Recent PRs, commits, or discussions related to this area>

## Testing Patterns
<How tests are structured, how to run them, relevant test files>

## Implementation Hints
<Specific observations that would help an agent complete the task correctly>

## Gotchas & Constraints
<Non-obvious constraints, edge cases, or common mistakes in this area>

CONSTRAINTS:
- DO NOT modify any files. You are read-only.
- Keep the bundle under 20,000 tokens (roughly 15,000 words / 60,000 characters).
- Be specific — include actual file paths, function names, and code snippets where useful.
- Focus on information that would SAVE TIME for the implementing agent.

ACCEPTANCE CRITERIA THE AGENT WILL BE EVALUATED ON:
${criteria}`;
}

export function buildContextCollectionPrompt(task: string): string {
  return `Gather all relevant context for this task:\n\n${task}`;
}

export function buildContextEnhancedSystemSuffix(criteria: string): string {
  return `You are completing a coding task. Work autonomously — do not ask questions.
A context researcher has already gathered relevant information about this codebase for you.
USE this context to work more efficiently — it contains file paths, patterns, and implementation hints.
Complete the task fully. When done, output a brief summary of what you changed.

ACCEPTANCE CRITERIA (your work will be evaluated against these):
${criteria}`;
}

export function buildContextEnhancedPrompt(task: string, contextBundle: string): string {
  return `## Pre-gathered Context

${contextBundle}

---

## Your Task

${task}`;
}
