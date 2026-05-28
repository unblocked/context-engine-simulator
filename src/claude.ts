import { spawn } from "node:child_process";
import type { AgentInvokeOptions, ClaudeRawOutput, AgentResult } from "./types.js";
import { ContaminationError } from "./types.js";
import { createStreamState, processStreamChunk } from "./stream.js";

function parseClaudeOutput(raw: ClaudeRawOutput): AgentResult {
  return {
    success: !raw.is_error,
    result: raw.result ?? "",
    durationMs: raw.duration_ms,
    costUsd: raw.total_cost_usd,
    inputTokens: raw.usage.input_tokens,
    outputTokens: raw.usage.output_tokens,
    cacheReadTokens: raw.usage.cache_read_input_tokens,
    cacheCreationTokens: raw.usage.cache_creation_input_tokens,
    numTurns: raw.num_turns,
    sessionId: raw.session_id,
    structuredOutput: raw.structured_output,
  };
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

export function invokeClaude(opts: AgentInvokeOptions): Promise<AgentResult> {
  const streaming = opts.verbose ?? false;
  const hasBannedServers = (opts.bannedMcpServers?.length ?? 0) > 0;
  const useStreaming = streaming || hasBannedServers;
  const args: string[] = ["-p", "--output-format", useStreaming ? "stream-json" : "json", "--model", opts.model];

  if (useStreaming) {
    args.push("--verbose");
  }

  if (opts.worktree) {
    args.push("--worktree", opts.worktree);
  }

  if (opts.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  if (opts.systemPrompt) {
    args.push("--system-prompt", opts.systemPrompt);
  }

  if (opts.appendSystemPrompt) {
    args.push("--append-system-prompt", opts.appendSystemPrompt);
  }

  if (opts.disallowedTools?.length) {
    args.push("--disallowed-tools", ...opts.disallowedTools);
  }

  if (opts.allowedTools?.length) {
    args.push("--allowed-tools", ...opts.allowedTools);
  }

  if (opts.tools !== undefined) {
    args.push("--tools", opts.tools);
  }

  if (opts.jsonSchema) {
    args.push("--json-schema", opts.jsonSchema);
  }

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...opts.env },
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, opts.timeoutMs);

    child.stdin.write(opts.prompt);
    child.stdin.end();

    if (useStreaming) {
      const tag = opts.tag ?? "claude";
      const state = createStreamState();
      let finalResult: ClaudeRawOutput | null = null;
      let contaminated = false;

      child.stdout.on("data", (chunk: Buffer) => {
        if (contaminated) return;
        processStreamChunk(chunk.toString(), tag, state, {
          onResult: (e) => { finalResult = e as unknown as ClaudeRawOutput; },
          bannedMcpServers: opts.bannedMcpServers,
          onContamination: (server, detail) => {
            if (contaminated) return;
            contaminated = true;
            child.kill("SIGTERM");
            clearTimeout(timer);
            reject(new ContaminationError(server, detail));
          },
        });
      });

      child.stderr.on("data", (d: Buffer) => {
        if (streaming) process.stderr.write(`[${tag}:stderr] ${d}`);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (contaminated) return;
        if (state.partial) {
          processStreamChunk(state.partial + "\n", tag, state, {
            onResult: (e) => { finalResult = e as unknown as ClaudeRawOutput; },
          });
        }
        if (finalResult) {
          resolve(parseClaudeOutput(finalResult));
        } else {
          resolve(failedResult(`No result event in stream. Exit code: ${code}`));
        }
      });
    } else {
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          const raw: ClaudeRawOutput = JSON.parse(stdout);
          resolve(parseClaudeOutput(raw));
        } catch {
          resolve(
            failedResult(
              `Failed to parse claude output. Exit code: ${code}. stderr: ${stderr.slice(0, 500)}. stdout: ${stdout.slice(0, 500)}`
            )
          );
        }
      });
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(failedResult(`Failed to spawn claude: ${err.message}`));
    });
  });
}
