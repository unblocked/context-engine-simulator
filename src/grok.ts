import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { AgentInvokeOptions, AgentResult } from "./types.js";
import { log } from "./util.js";

// Grok exposes no per-turn usage in its stdout. Its session dir's signals.json
// records `contextTokensUsed` — the real peak context-window token count (input
// + tool results + reasoning + output). It does NOT split input/output, so we
// report the real aggregate as inputTokens and leave outputTokens at 0 rather
// than fabricate a split. grok-build is subscription-priced (no per-token rate),
// so costUsd stays 0.
function readGrokTokens(sessionId: string): number {
  if (!sessionId) return 0;
  const base = join(homedir(), ".grok", "sessions");
  try {
    if (!existsSync(base)) return 0;
    for (const cwdDir of readdirSync(base)) {
      const signals = join(base, cwdDir, sessionId, "signals.json");
      if (existsSync(signals)) {
        const s = JSON.parse(readFileSync(signals, "utf-8")) as { contextTokensUsed?: number };
        return s.contextTokensUsed ?? 0;
      }
    }
  } catch { /* token metrics are best-effort; never fail the run over them */ }
  return 0;
}

interface GrokStreamEvent {
  type: "thought" | "text" | "end" | string;
  data?: string;
  stopReason?: string;
  sessionId?: string;
  requestId?: string;
}

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

function writeTempPrompt(prompt: string): string {
  const name = `ces-${randomBytes(6).toString("hex")}.txt`;
  const p = join(tmpdir(), name);
  writeFileSync(p, prompt);
  return p;
}

function invokeGrokBinary(
  binary: string,
  opts: AgentInvokeOptions,
): Promise<AgentResult> {
  const promptFile = writeTempPrompt(opts.prompt);
  const verbose = opts.verbose ?? false;
  const tag = opts.tag ?? binary;

  const args: string[] = [
    "--prompt-file", promptFile,
    "--output-format", "streaming-json",
    "--cwd", opts.cwd,
    "--model", opts.model,
  ];

  if (opts.dangerouslySkipPermissions) {
    args.push("--permission-mode", "bypassPermissions");
  }

  if (opts.systemPrompt) {
    args.push("--system-prompt-override", opts.systemPrompt);
  }

  if (opts.appendSystemPrompt) {
    args.push("--rules", opts.appendSystemPrompt);
  }

  // Use --deny rules instead of --disallowed-tools: passing --disallowed-tools
  // corrupts grok's internal run_terminal_cmd config (auto_background_on_timeout
  // requires enabled_background), failing session creation.
  if (opts.disallowedTools?.length) {
    for (const tool of opts.disallowedTools) {
      args.push("--deny", tool);
    }
  }

  if (opts.allowedTools?.length) {
    args.push("--tools", opts.allowedTools.join(","));
  }

  if (opts.tools !== undefined) {
    args.push("--tools", opts.tools);
  }

  return new Promise((resolve) => {
    const start = Date.now();

    const child = spawn(binary, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...opts.env },
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, opts.timeoutMs);

    let stderr = "";
    let partial = "";
    let text = "";
    let thoughtBuf = "";
    let stopReason = "";
    let sessionId = "";
    let sawEnd = false;

    function flushThought(): void {
      if (verbose && thoughtBuf.trim()) {
        const t = thoughtBuf.trim().replace(/\s+/g, " ");
        log(`[${tag}] 💭 ${t.slice(0, 200)}${t.length > 200 ? "..." : ""}`);
      }
      thoughtBuf = "";
    }

    child.stdout.on("data", (chunk: Buffer) => {
      partial += chunk.toString();
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as GrokStreamEvent;
          if (e.type === "thought") {
            thoughtBuf += e.data ?? "";
          } else if (e.type === "text") {
            if (thoughtBuf) flushThought();
            text += e.data ?? "";
          } else if (e.type === "end") {
            if (thoughtBuf) flushThought();
            sawEnd = true;
            stopReason = e.stopReason ?? "";
            sessionId = e.sessionId ?? "";
            if (verbose && text.trim()) {
              log(`[${tag}] 🗣️  ${text.trim().slice(0, 200)}${text.length > 200 ? "..." : ""}`);
            }
          }
        } catch { /* skip non-JSON */ }
      }
    });

    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (verbose) process.stderr.write(`[${tag}:stderr] ${d}`);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      try { unlinkSync(promptFile); } catch { /* already cleaned */ }

      const durationMs = Date.now() - start;

      if (sawEnd || text) {
        const contextTokens = readGrokTokens(sessionId);
        resolve({
          success: stopReason === "EndTurn" || (!!text && code === 0),
          result: text,
          durationMs,
          costUsd: 0,
          inputTokens: contextTokens,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          numTurns: 1,
          sessionId,
        });
      } else {
        resolve(
          failedResult(
            `Failed to get ${binary} output. Exit code: ${code}. stderr: ${stderr.slice(0, 500)}`,
          ),
        );
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      try { unlinkSync(promptFile); } catch { /* already cleaned */ }
      resolve(failedResult(`Failed to spawn ${binary}: ${err.message}`));
    });
  });
}

// Grok's MCP workers intermittently crash with a fatal auth/transport error that
// kills the whole session before any output. It's transient — a retry usually
// succeeds. Detect that signature (no output + transport/auth crash) and retry once.
function isTransientCrash(r: AgentResult): boolean {
  if (r.success || r.result) return false;
  const e = r.error ?? "";
  return e.includes("Transport channel closed")
    || e.includes("worker quit with fatal")
    || e.includes("AuthorizationRequired")
    || e.includes("Exit code: null");
}

export async function invokeGrok(opts: AgentInvokeOptions): Promise<AgentResult> {
  let result = await invokeGrokBinary("grok", opts);
  if (isTransientCrash(result)) {
    log(`[${opts.tag ?? "grok"}] transient MCP crash — retrying once`);
    result = await invokeGrokBinary("grok", opts);
  }
  return result;
}
