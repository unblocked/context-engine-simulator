import { spawn } from "node:child_process";
import type { AgentInvokeOptions, AgentResult } from "./types.js";
import { ContaminationError } from "./types.js";
import { estimateCost, log } from "./util.js";

interface CodexItemEvent {
  type: "item.completed";
  item: { type: string; text: string };
}

interface CodexTurnEvent {
  type: "turn.completed";
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
  };
}

interface CodexThreadEvent {
  type: "thread.started";
  thread_id: string;
}

type CodexEvent = CodexItemEvent | CodexTurnEvent | CodexThreadEvent | { type: string };

function failedResult(error: string): AgentResult {
  return {
    success: false,
    result: "",
    durationMs: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    numTurns: 0,
    sessionId: "",
    error,
  };
}

function logCodexEvent(event: CodexEvent, tag: string, turnCount: number): void {
  if (event.type === "thread.started") {
    log(`[${tag}] Thread started: ${(event as CodexThreadEvent).thread_id}`);
  } else if (event.type === "item.completed" || event.type === "item.started") {
    const raw = JSON.parse(JSON.stringify(event)) as { item?: Record<string, unknown> };
    const item = raw.item ?? {};
    const itype = item.type as string;
    if (itype === "agent_message" && event.type === "item.completed") {
      const text = (item.text as string) ?? "";
      log(`[${tag}] 🗣️  ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`);
    } else if (itype === "command_execution" && event.type === "item.started") {
      const cmd = (item.command as string) ?? "";
      log(`[${tag}]   Shell: ${cmd.slice(0, 150)}`);
    } else if (itype === "mcp_tool_call" && event.type === "item.started") {
      const server = (item.server as string) ?? "";
      const tool = (item.tool as string) ?? "";
      log(`[${tag}]   MCP: ${server}/${tool}`);
    } else if (itype === "command_execution" && event.type === "item.completed") {
      const output = (item.aggregated_output as string) ?? "";
      if (output) log(`[${tag}]   ↳ ${output.trim().slice(0, 150)}`);
    } else if (itype === "mcp_tool_call" && event.type === "item.completed") {
      // mcp result logged on completion — skip noise
    } else if (event.type === "item.completed") {
      const text = (item.text as string) ?? "";
      if (text) log(`[${tag}]   [${itype}] ${text.slice(0, 150)}`);
    }
  } else if (event.type === "turn.completed") {
    const usage = (event as CodexTurnEvent).usage;
    log(`[${tag}] Turn ${turnCount}: ${usage.input_tokens} in / ${usage.output_tokens} out`);
  } else if (event.type !== "thread.started") {
    const raw = JSON.stringify(event).slice(0, 200);
    log(`[${tag}]   [evt:${event.type}] ${raw}`);
  }
}

export function invokeCodex(opts: AgentInvokeOptions): Promise<AgentResult> {
  const args: string[] = ["exec", "--json", "-C", opts.cwd, "-m", opts.model];
  const verbose = opts.verbose ?? false;
  const tag = opts.tag ?? "codex";
  const banned = new Set((opts.bannedMcpServers ?? []).map(s => s.toLowerCase()));

  for (const server of banned) {
    args.push("-c", `mcp_servers.${server}.url=""`);
  }

  if (opts.dangerouslySkipPermissions) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (opts.tools === "") {
    args.push("-s", "read-only");
  }

  return new Promise((resolve, reject) => {
    const start = Date.now();

    const child = spawn("codex", args, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...opts.env },
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, opts.timeoutMs);

    const systemText = [opts.systemPrompt, opts.appendSystemPrompt]
      .filter(Boolean)
      .join("\n\n");
    const fullPrompt = systemText
      ? `${systemText}\n\n---\n\n${opts.prompt}`
      : opts.prompt;

    child.stdin.write(fullPrompt);
    child.stdin.end();

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let sessionId = "";
    let numTurns = 0;
    let partial = "";
    let contaminated = false;

    child.stdout.on("data", (chunk: Buffer) => {
      partial += chunk.toString();
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";

      for (const line of lines) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as CodexEvent;
          if (event.type === "thread.started") {
            sessionId = (event as CodexThreadEvent).thread_id;
          }
          if (event.type === "item.completed" || event.type === "item.started") {
            const item = (event as CodexItemEvent).item;
            if (item.type === "agent_message" && event.type === "item.completed") text = item.text;
            if (item.type === "mcp_tool_call" && banned.size > 0) {
              const raw = JSON.parse(line) as { item?: { server?: string } };
              const server = raw.item?.server?.toLowerCase();
              if (server && banned.has(server)) {
                contaminated = true;
                log(`[${tag}] CONTAMINATION: codex called banned MCP server '${server}' — killing`);
                child.kill("SIGTERM");
              }
            }
          }
          if (event.type === "turn.completed") {
            const usage = (event as CodexTurnEvent).usage;
            inputTokens += usage.input_tokens ?? 0;
            outputTokens += usage.output_tokens ?? 0;
            cachedInputTokens += usage.cached_input_tokens ?? 0;
            numTurns++;
          }
          if (verbose) logCodexEvent(event, tag, numTurns);
        } catch { /* skip non-JSON */ }
      }
    });

    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (verbose) process.stderr.write(`[${tag}:stderr] ${d}`);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;

      if (contaminated) {
        reject(new ContaminationError("codex", "called banned MCP server during execution"));
        return;
      }

      if (!text && code !== 0) {
        resolve(
          failedResult(
            `Codex exited with code ${code}${timedOut ? " (timeout)" : ""}. stderr: ${stderr.slice(0, 500)}`,
          ),
        );
        return;
      }

      const uncachedInput = Math.max(0, inputTokens - cachedInputTokens);
      const tokens = { inputTokens: uncachedInput, outputTokens, cacheReadTokens: cachedInputTokens, cacheCreationTokens: 0 };
      resolve({
        success: code === 0 || timedOut,
        result: text,
        durationMs,
        costUsd: estimateCost(opts.model, tokens),
        inputTokens: uncachedInput,
        outputTokens,
        cacheReadTokens: cachedInputTokens,
        cacheCreationTokens: 0,
        numTurns: numTurns || (timedOut && text ? 1 : 0),
        sessionId,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(failedResult(`Failed to spawn codex: ${err.message}`));
    });
  });
}
