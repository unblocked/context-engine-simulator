import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { AgentInvokeOptions, AgentResult } from "./types.js";

interface GrokRawOutput {
  text?: string;
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
    "--output-format", "json",
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

  if (opts.disallowedTools?.length) {
    args.push("--disallowed-tools", opts.disallowedTools.join(","));
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

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (verbose) process.stderr.write(`[${tag}:stderr] ${d}`);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      try { unlinkSync(promptFile); } catch { /* already cleaned */ }

      const durationMs = Date.now() - start;

      try {
        const raw: GrokRawOutput = JSON.parse(stdout.trim());
        resolve({
          success: raw.stopReason === "EndTurn",
          result: raw.text ?? "",
          durationMs,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          numTurns: 1,
          sessionId: raw.sessionId ?? "",
        });
      } catch {
        resolve(
          failedResult(
            `Failed to parse ${binary} output. Exit code: ${code}. stderr: ${stderr.slice(0, 500)}. stdout: ${stdout.slice(0, 500)}`,
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

export function invokeGrok(opts: AgentInvokeOptions): Promise<AgentResult> {
  return invokeGrokBinary("grok", opts);
}
