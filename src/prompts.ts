// ── Plan stage ──────────────────────────────────────────────────────

export function buildPlanSystemSuffix(hasContext: boolean): string {
  const contextAddendum = hasContext
    ? `\n\nA pre-gathered context bundle is provided below with file paths, code patterns, and organizational context. Use it as your starting point — it gives you a head start on understanding the codebase. You can still read files and explore as needed to fill in gaps.`
    : "";

  return `You are creating an implementation plan for a coding task. Work autonomously — do not ask questions. Do NOT modify any files.

Produce an implementation plan that fully solves the task.${contextAddendum}

Output ONLY the implementation plan.`;
}

export function buildBaselinePlanPrompt(task: string): string {
  return task;
}

export function buildContextPlanPrompt(task: string, contextBundle: string, mandatoryPatterns: string): string {
  return `## CODEBASE STYLE PATTERNS

Follow these coding style patterns when describing the approach. They reflect how this codebase writes code — error handling, naming, DI, etc.

${mandatoryPatterns}

---

## Pre-gathered Context

${contextBundle}

---

## Task to Plan

${task}`;
}

// ── Review stage ────────────────────────────────────────────────────

export function buildBaselineReviewSystemSuffix(): string {
  return buildReviewSystemSuffix(false);
}

export function buildBaselineReviewPrompt(task: string, plan: string): string {
  return `## Original Task

${task}

---

## Implementation Plan to Review

${plan}`;
}

export function buildContextReviewSystemSuffix(): string {
  return buildReviewSystemSuffix(true);
}

function buildReviewSystemSuffix(hasContext: boolean): string {
  const contextAddendum = hasContext
    ? `\n\nOperational context has been gathered for this plan (incidents, past decisions, codebase patterns). Use it to inform your review — if the context reveals risks or pattern violations, adjust the plan accordingly.`
    : "";

  return `You are reviewing an implementation plan for correctness and risks. Work autonomously — do not ask questions.

Review the plan below. Check for:
- Correctness of file paths, function names, and patterns
- Deployment risks, performance implications, edge cases
- Anything the plan missed or got wrong
- Whether the plan fully covers the task scope${contextAddendum}

If you find issues, produce an ADJUSTED version of the plan with your corrections incorporated.
If the plan is sound, output it as-is with a brief confirmation note.

Do NOT add scope beyond what the task requires. The plan defines scope — you may change HOW something is done, not add MORE things to do.

Your output will be passed directly to an implementing agent as their instructions, so it must be a complete, actionable plan.`;
}

export function buildContextReviewPrompt(task: string, plan: string, planContext: string, mandatoryPatterns: string): string {
  return `## CODEBASE STYLE PATTERNS

The plan should follow these coding style patterns. Flag if the plan's approach contradicts any of them.

${mandatoryPatterns}

---

## Original Task

${task}

---

## Implementation Plan to Review

${plan}

---

## Operational Context for This Plan

${planContext}`;
}

// ── Implement stage ─────────────────────────────────────────────────

export function buildImplementSystemSuffix(): string {
  return `You are completing a coding task. Work autonomously — do not ask questions.
Follow the implementation plan below. The plan defines the SCOPE and APPROACH — implement everything it describes.

Read the files you need to edit before modifying them. If the plan references codebase patterns (error handling, DI, concurrency), follow those patterns — they reflect how this codebase works.

Stay within the plan's scope: don't add tests, refactors, or features it doesn't call for. But you have full latitude on HOW to implement — read files, understand the code, write the solution.

Do NOT attempt to build, compile, or run tests. Just write the code then exit.

When done, output a brief summary of what you changed.`;
}

export function buildImplementPrompt(plan: string): string {
  return plan;
}

// ── Eval stage ──────────────────────────────────────────────────────

export function buildEvalSystemPrompt(): string {
  return `You are an impartial code evaluator. You will be given:
1. A TASK that was assigned to a coding agent
2. ACCEPTANCE CRITERIA the output must satisfy
3. The AGENT OUTPUT (what the agent said it did)
4. The CODE DIFF (the actual file changes the agent made — this is the ground truth)

Base your evaluation PRIMARILY on the CODE DIFF, not the agent's description. The diff shows exactly what was changed. The agent output is supplementary context only.

Score the output 0-100 where:
- 0 = nothing useful was done
- 25 = some progress but major criteria unmet
- 50 = partial completion, some criteria met
- 75 = mostly complete, minor issues
- 100 = all acceptance criteria fully satisfied

You MUST respond with EXACTLY this JSON format and nothing else:
{"score": <number>, "reasoning": "<one paragraph explanation>"}`;
}

export function buildEvalPrompt(task: string, criteria: string, agentOutput: string, codeDiff: string): string {
  return `TASK:
${task}

ACCEPTANCE CRITERIA:
${criteria}

AGENT OUTPUT:
${agentOutput}

CODE DIFF (actual file changes — ground truth):
${codeDiff}`;
}

export const EVAL_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 },
    reasoning: { type: "string" },
  },
  required: ["score", "reasoning"],
});

// ── Context attribution analysis ──────────────────────────────────

export function buildContextAttributionSystemPrompt(): string {
  return `You are analyzing how pre-gathered context influenced a coding agent's implementation. You will receive:

1. INITIAL CONTEXT BUNDLE — gathered before planning
2. PLAN CONTEXT BUNDLE — gathered after planning, focused on risks
3. CODE DIFF — the actual implementation produced by the context-enhanced agent

Your job: trace which specific pieces of gathered context were actually USED in the implementation. "Used" means the context directly influenced a code decision — not just that it was available.

For each source category, list:
- "gathered": what information was collected from this source (brief)
- "used": which of those findings actually appear in or influenced the code diff (be specific — cite the code change)
- "impact": how much this source influenced the implementation quality
  - "high" = implementation would be significantly worse without this context
  - "medium" = helped but agent might have found it independently
  - "low" = collected but barely influenced the code
  - "none" = collected but no trace in the implementation

Categories to evaluate (include ALL, even if empty):
- "Code Search" — patterns, conventions, file structure found by reading the codebase
- "Slack" — team discussions, decisions, deployment notes
- "Notion / Confluence" — documentation, runbooks, design docs
- "Jira / Linear" — tickets, issues, prior work
- "Git History" — recent commits, PRs, blame context
- "Other MCP" — any other MCP tool results (Unblocked, etc.)

Be honest. If a source contributed nothing, say so. The goal is to understand WHERE valuable context comes from.

Respond with ONLY the JSON array — no wrapping object, no commentary.`;
}

export function buildContextAttributionPrompt(
  initialContext: string,
  planContext: string,
  codeDiff: string,
): string {
  return `INITIAL CONTEXT BUNDLE:
${initialContext}

PLAN CONTEXT BUNDLE:
${planContext}

CODE DIFF (context-enhanced implementation):
${codeDiff}`;
}

export const CONTEXT_ATTRIBUTION_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    attributions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          gathered: { type: "array", items: { type: "string" } },
          used: { type: "array", items: { type: "string" } },
          impact: { type: "string", enum: ["high", "medium", "low", "none"] },
        },
        required: ["category", "gathered", "used", "impact"],
      },
    },
  },
  required: ["attributions"],
});

// ── Pattern extraction ─────────────────────────────────────────────

export function buildPatternExtractionSystemPrompt(): string {
  return `You are extracting coding STYLE patterns from a context bundle — the conventions a developer must follow when writing code in this area.

Focus on HOW code is written, not WHAT components exist. Extract patterns like:
- Error handling style (e.g. runSuspendCatching vs try/catch)
- Naming conventions
- DI / constructor patterns
- Test patterns (mocking style, assertion style)
- Concurrency patterns (coroutine usage, scoping)

Do NOT extract architectural decisions or component descriptions (e.g. "there's a RoundRobinService that does X"). Those belong in the context bundle, not in style patterns.

For each pattern, output:
1. A short descriptive name
2. A code snippet from the codebase showing the pattern
3. One sentence explaining WHEN to use this pattern

RULES:
- Output ONLY a numbered list of patterns with code snippets. No preamble, no analysis, no summary.
- Include only patterns that are ESTABLISHED in the codebase (appear in multiple places or are clearly the convention).
- If no clear patterns are found, output "No established patterns identified."
- Keep output under 2000 tokens.`;
}

export function buildPatternExtractionPrompt(contextBundle: string): string {
  return `Extract all mandatory codebase patterns from this context bundle:\n\n${contextBundle}`;
}

// ── Initial context collection ──────────────────────────────────────

export function buildContextCollectionSystemSuffix(): string {
  return `You are a context researcher preparing a briefing for a coding agent who will work on a task.

YOUR MISSION: Gather the context that would help another agent complete the task correctly and efficiently. Focus on context DIRECTLY relevant to the task — the files it touches, the patterns it must follow, and the organizational knowledge that would change the approach.

DO NOT explore the entire repository. Stay focused on the task's blast radius: the files being modified, their immediate dependencies, and similar patterns nearby. Breadth matters less than depth on the right files.

YOU MUST COMPLETE ALL THREE PASSES BELOW IN ORDER. Do NOT produce the final bundle until all three passes are done.

## PASS 1: Codebase Search (focused on the task's blast radius)
- Read README, CLAUDE.md if they exist — skim for conventions, don't study
- Use grep to find the specific files, classes, and functions mentioned in the task
- Read those files fully plus their immediate dependencies (imports, callers, tests)
- Find 2-3 similar implementations nearby to establish the local pattern — don't catalog every instance in the repo
- Search git log for recent commits to the affected files only (not the whole project)
- Read the test file(s) for the code being modified

### Established Patterns
Find 2-3 examples of similar work in the SAME module or package. Show concrete code snippets from those examples — the implementing agent needs to match the local style, not a repo-wide survey.

## PASS 2: External Context Search — MANDATORY

THIS PASS IS NOT OPTIONAL. You MUST search external sources. Skipping this pass is a failure condition.

### CLI Tools — Check What's Available

Before searching external sources, check what CLI tools you have access to:
- Run \`which gh\` to check for the GitHub CLI. If available, use it extensively:
  - \`gh search prs\` / \`gh pr list\` — find PRs related to this area
  - \`gh search issues\` / \`gh issue list\` — find related issues
  - \`gh pr view <number>\` — read PR descriptions and review discussions
  - \`gh api\` — query repos, commits, check runs, and other GitHub data
  GitHub PRs and issues contain critical context: why code was written, what was tried before, what reviewers flagged.

### MCP Servers & External Tools — EXHAUSTIVE SEARCH REQUIRED

FIRST: Discover what external tools you have access to. Check your available tools for anything that connects to Slack, Notion, Confluence, Jira, Linear, or other external sources. If you have a ListMcpResources tool, call it. If you see tools prefixed with mcp__ or named after external services, those are MCP integrations. You MUST call every external source you find — this is not optional.

### Messaging & Chat (e.g. Slack)
Make AT LEAST 3 separate searches with DIFFERENT queries:
1. Search for team discussions about the specific components or systems in the task
2. Search for deployment discussions, incident threads, or operational concerns related to this area
3. Search for architectural decisions or debates about the affected systems
Read the most relevant threads. When you find content that would change how an agent approaches this task, include it in your bundle with attribution (who, when, channel). Skip noise — only include context that affects implementation decisions.

### Documentation (e.g. Notion, Confluence)
Make AT LEAST 4 separate searches with DIFFERENT queries:
1. Search for the specific components or systems mentioned in the task
2. Search for incidents related to the affected systems
3. Search for runbooks or operational documentation related to the type of change
4. Search for retrospectives or postmortems related to this area
Fetch and read the most relevant pages. Include key excerpts that would affect implementation — architectural decisions, constraints, known pitfalls. Skip general background.

### Issue Tracking (e.g. Jira, Linear, or gh CLI)
- Search for issues or tickets related to the affected systems
- Look for prior work, known bugs, or planned changes in this area
- Check for linked incidents or related epics

### Any other MCP servers or CLI tools available
- Call them with relevant queries about this task area

CRITICAL: When external sources contain information relevant to this task, include the actual content in your bundle — not just "I searched Slack and found some discussions." The implementing agent cannot access these sources. But be selective: only include content that would change how an agent approaches the task. Skip generic background noise.

If a tool errors or returns nothing, log the attempt and move on.

## PASS 3: Operational Risk & Implications

Now that you have context from the codebase AND from organizational sources, do a FINAL search pass focused on:
- Past incidents or outages related to this area of the codebase
- Performance implications of the proposed changes
- Deployment risks (ordering, feature flags, backward compatibility)
- Downstream consumers that could break
- Rate limits, quotas, or resource constraints that could be hit
- Security implications

Make additional MCP calls specifically focused on operational risk:
- Search for incidents mentioning the affected systems
- Search for retrospectives or postmortems related to similar changes
- Fetch and read any incident pages, runbooks, or retrospectives you find

## OUTPUT FORMAT

Produce a context bundle in Markdown with these sections:

# Context Bundle

## Project Overview
<Brief description of the project, tech stack, build system>

## Relevant Architecture
<How the relevant parts of the codebase are structured, key abstractions>

## Key Files
<List of files most relevant to the task, with brief descriptions of what each contains>

## Relevant Code Patterns (CRITICAL — include actual code snippets)
<For each pattern, show the EXACT code from the codebase. Include: error handling pattern, concurrency pattern, data fetching pattern, UI rendering pattern. The implementing agent MUST follow these patterns.>

## Related History
<Recent PRs, commits, discussions, or decisions related to this area>

## External Context (from Slack, Notion, Issues, etc.)
<Task-relevant findings from external sources with attribution (who, when, where). Include actual content that would affect implementation decisions — architectural constraints, past incidents, team decisions. If no external sources returned useful results, list what you searched and note that nothing relevant was found.>

## Testing Patterns
<How tests are structured, how to run them, relevant test files>

## Implementation Hints
<Specific observations that would help an agent complete the task correctly>

## Operational Risks & Considerations
<Past incidents, performance concerns, deployment risks, downstream impacts, security implications — anything from Pass 2 and Pass 3>

## Gotchas & Constraints
<Non-obvious constraints, edge cases, or common mistakes in this area>

## CRITICAL RULES
- You are a RESEARCHER, not an implementer. DO NOT write code. DO NOT describe what changes to make. DO NOT produce a solution. Your ONLY job is to gather and organize EXISTING context from the codebase and external sources.
- DO NOT modify any files. You are read-only.
- Keep the bundle under 8,000 tokens. Be concise. Code snippets should be short — show the pattern, not the whole file.
- Be specific — include actual file paths, function names, and code snippets FROM EXISTING CODE where useful.
- Focus on information that would SAVE TIME for the implementing agent.
- If an MCP tool errors or is unavailable, note it and move on — do not stop.
- Your final output MUST be ONLY the context bundle in the format above. No preamble, no implementation plan, no solution description.`;
}

export function buildContextCollectionPrompt(task: string, contextInstructions: string): string {
  let prompt = `Gather all relevant context for this task:\n\n${task}`;
  if (contextInstructions) {
    prompt += `\n\n## Additional Instructions\n\n${contextInstructions}`;
  }
  return prompt;
}

// ── Plan-targeted context collection ────────────────────────────────

export function buildPlanContextSystemSuffix(): string {
  return `You are a context researcher doing a TARGETED search for operational risks related to a specific implementation plan.

An initial context bundle was already gathered. A coding agent then produced an implementation plan based on that context. Your job is to find ALL operational context that could affect whether this plan succeeds or fails.

## PASS 1: STYLE & IDIOM CHECK

Check whether the plan's approach uses this codebase's coding style. Look at nearby callers and sibling files for:
- Error handling style (wrappers, catch patterns)
- Concurrency patterns (coroutine scoping, parallel vs sequential)
- DI and constructor conventions
- Test patterns

Note any style deviations so the implementer can match codebase conventions. This is about HOW code is written, not WHAT to build — the plan owns architectural decisions.

## PASS 2: OPERATIONAL RISK SEARCH

Focus on the SPECIFIC operations proposed in the plan. For each significant change the plan proposes, search for:
- Past incidents or outages caused by similar changes
- Known failure modes for the techniques the plan uses
- Team discussions about prior attempts at similar work
- Operational runbooks or documentation for this type of change

## MANDATORY EXTERNAL SEARCHES

You MUST search external sources. Do NOT skip this.

### CLI Tools — Check What's Available

Run \`which gh\` to check for the GitHub CLI. If available, use it:
- \`gh search prs\` / \`gh pr list\` — find PRs that modified the same files or systems
- \`gh search issues\` — find related issues, bugs, or feature requests
- \`gh pr view <number>\` — read PR review discussions for context on past decisions

### MCP Servers

FIRST: Discover what external tools you have access to. If you have a ListMcpResources tool, call it. If you see tools prefixed with mcp__ or named after external services, those are MCP integrations. Call EVERY external source you find.

Search exhaustively — multiple queries per server.

### Messaging & Chat (e.g. Slack)
Make AT LEAST 3 separate searches:
1. Search for discussions about the specific operations the plan proposes
2. Search for incident threads related to the affected systems
3. Search for deployment discussions about similar changes
When you find content that affects how the plan should be executed, include it with attribution (who, when, channel). Be selective — only what's relevant to this specific plan.

### Documentation (e.g. Notion, Confluence)
Make AT LEAST 4 searches with DIFFERENT queries targeting the plan's specifics:
1. Search for incidents related to the specific systems the plan modifies
2. Search for runbooks or operational docs related to the type of change
3. Search for retrospectives or postmortems related to similar changes
4. Search for the specific techniques or tools the plan proposes using
Fetch and read the most relevant pages. Include excerpts that would affect how the plan is executed.

### Issue Tracking (e.g. Jira, Linear, or gh CLI)
- Search for issues or tickets related to the systems the plan modifies
- Look for prior work or known bugs that could affect the plan
- Check for linked incidents or related epics

### Any other MCP servers or CLI tools available
- Call them with queries about the plan's proposed changes

CRITICAL: When external sources contain task-relevant information, include the actual content — not just a note that you searched. The implementing agent cannot access these sources. Be selective: only what would change implementation decisions.

## OUTPUT FORMAT

Produce a targeted assessment in Markdown:

# Plan Context

## Coding Style Notes
<Any codebase style conventions the implementer should follow (error handling, naming, DI, concurrency). Brief — just what differs from the plan's implied approach.>

## Operational Risks Found
<Past incidents, outages, or near-misses related to the proposed changes. Include incident numbers, dates, and key takeaways.>

## Risks of the Proposed Approach
<What could go wrong if the plan is followed as-is?>

## Risks of Alternative Approaches
<What could go wrong if the plan's approach is REJECTED in favor of simpler/conventional alternatives? Often the "untested" approach exists because the conventional one failed in production.>

## Deployment Considerations
<Ordering, rollback strategy, monitoring, any operational concerns>

## MCP Search Log
<What you searched for and what you found/didn't find — one line per search>

## CRITICAL RULES
- You are a RESEARCHER, not an implementer. DO NOT write code.
- DO NOT modify any files. You are read-only.
- Focus on RISKS and OPERATIONAL CONTEXT specific to this plan.
- Be specific — include actual incident numbers, dates, quotes from discussions.
- Keep output under 10,000 tokens.
- If an MCP tool errors or is unavailable, note it and move on.
- Your final output MUST be ONLY the risk assessment in the format above.`;
}

export function buildPlanContextPrompt(
  task: string,
  plan: string,
  initialContext: string,
  contextInstructions: string,
): string {
  let prompt = `## Implementation Plan to Investigate

${plan}

---

## Original Task

${task}

---

## Initial Context Already Gathered

${initialContext}`;

  if (contextInstructions) {
    prompt += `\n\n---\n\n## Additional Instructions\n\n${contextInstructions}`;
  }
  return prompt;
}
