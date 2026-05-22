import { spawn } from "node:child_process";
import type { ClaudeInvokeOptions, ClaudeRawOutput, ClaudeResult } from "./types.js";

function parseClaudeOutput(raw: ClaudeRawOutput): ClaudeResult {
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
  };
}

function failedResult(error: string): ClaudeResult {
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

export function invokeClaude(opts: ClaudeInvokeOptions): Promise<ClaudeResult> {
  const args: string[] = ["-p", "--output-format", "json", "--model", opts.model];

  if (opts.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  if (opts.systemPrompt) {
    args.push("--system-prompt", opts.systemPrompt);
  }

  if (opts.appendSystemPrompt) {
    args.push("--append-system-prompt", opts.appendSystemPrompt);
  }

  if (opts.maxBudgetUsd > 0) {
    args.push("--max-budget-usd", opts.maxBudgetUsd.toString());
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

  return new Promise((resolve) => {
    const child = spawn("claude", args, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, opts.timeoutMs);

    child.stdin.write(opts.prompt);
    child.stdin.end();

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

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(failedResult(`Failed to spawn claude: ${err.message}`));
    });
  });
}
