import { log } from "./util.js";

export interface StreamState {
  turnCount: number;
  toolCount: number;
  editCount: number;
  thinkBuf: string;
  partial: string;
}

export function createStreamState(): StreamState {
  return { turnCount: 0, toolCount: 0, editCount: 0, thinkBuf: "", partial: "" };
}

function formatToolLabel(tc: Record<string, unknown>, state: StreamState): string {
  const mcpCall = tc.mcpToolCall as Record<string, unknown> | undefined;
  if (mcpCall) {
    const mcp = (mcpCall.args ?? mcpCall) as Record<string, unknown>;
    const server = (mcp.providerIdentifier ?? mcp.serverName ?? "") as string;
    const tool = (mcp.toolName ?? "") as string;
    let label = `MCP:${server}/${tool}`;
    const args = mcp.args as Record<string, unknown> | undefined;
    const query = (args?.query as string) ?? "";
    if (query) label += ` "${query.slice(0, 80)}"`;
    return label;
  }

  const shellCall = tc.shellToolCall as Record<string, unknown> | undefined;
  if (shellCall) {
    const args = shellCall.args as Record<string, unknown> | undefined;
    return `Shell: ${((args?.command as string) ?? "").slice(0, 100)}`;
  }

  const editCall = (tc.editToolCall ?? tc.strReplaceToolCall) as Record<string, unknown> | undefined;
  if (editCall) {
    state.editCount++;
    const args = editCall.args as Record<string, unknown> | undefined;
    const ep = (args?.path as string) ?? "";
    return `Edit #${state.editCount}: ...${ep.slice(-60)}`;
  }

  const readCall = tc.readToolCall as Record<string, unknown> | undefined;
  if (readCall) {
    const args = readCall.args as Record<string, unknown> | undefined;
    return `Read: ...${((args?.path as string) ?? "").slice(-60)}`;
  }

  const grepCall = tc.grepToolCall as Record<string, unknown> | undefined;
  if (grepCall) {
    const args = grepCall.args as Record<string, unknown> | undefined;
    return `Grep: ${((args?.pattern as string) ?? "").slice(0, 80)}`;
  }

  const globCall = tc.globToolCall as Record<string, unknown> | undefined;
  if (globCall) {
    const args = globCall.args as Record<string, unknown> | undefined;
    return `Glob: ${((args?.globPattern as string) ?? "").slice(0, 80)}`;
  }

  return "";
}

function formatToolOutput(tc: Record<string, unknown>): string {
  const shell = tc.shellToolCall as Record<string, unknown> | undefined;
  if (shell) {
    const result = shell.result as Record<string, unknown> | undefined;
    const success = result?.success as Record<string, unknown> | undefined;
    const out = (success?.stdout as string) ?? "";
    if (out) return out.trim().slice(0, 150);
  }

  const glob = tc.globToolCall as Record<string, unknown> | undefined;
  if (glob) {
    const result = glob.result as Record<string, unknown> | undefined;
    const success = result?.success as Record<string, unknown> | undefined;
    const files = (success?.files as string[]) ?? [];
    if (files.length) return `${files.length} files`;
  }

  const grep = tc.grepToolCall as Record<string, unknown> | undefined;
  if (grep) {
    const result = grep.result as Record<string, unknown> | undefined;
    const success = result?.success as Record<string, unknown> | undefined;
    const matches = (success?.numMatches as number) ?? (success?.matches as unknown[])?.length ?? null;
    if (matches !== null) return `${matches} matches`;
  }

  return "";
}

export function handleStreamEvent(e: Record<string, unknown>, tag: string, state: StreamState): void {
  if (e.type === "thinking" && e.subtype === "delta") {
    state.thinkBuf += (e.text as string) ?? "";
  } else if (e.type === "thinking" && e.subtype === "completed") {
    if (state.thinkBuf) {
      const trimmed = state.thinkBuf.trim().replace(/\s+/g, " ");
      log(`[${tag}] 💭 ${trimmed.slice(0, 200)}${trimmed.length > 200 ? "..." : ""}`);
      state.thinkBuf = "";
    }
  } else if (e.type === "assistant") {
    state.turnCount++;
    let text = "";
    const msg = e.message as Record<string, unknown> | undefined;
    const content = msg?.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === "text" && b.text) text += b.text as string;
      }
    }
    if (text) {
      log(`[${tag}] 🗣️  Turn ${state.turnCount}: ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`);
    }
  } else if (e.type === "tool_call" && e.subtype === "started") {
    state.toolCount++;
    const tc = (e.tool_call ?? {}) as Record<string, unknown>;
    const label = formatToolLabel(tc, state);
    if (label) log(`[${tag}]   #${state.toolCount} ${label}`);
  } else if (e.type === "tool_call" && e.subtype === "completed") {
    const tc = (e.tool_call ?? {}) as Record<string, unknown>;
    const output = formatToolOutput(tc);
    if (output) log(`[${tag}]   ↳ ${output}`);
  }
}

export interface StreamOptions {
  onResult?: (e: Record<string, unknown>) => void;
  onContamination?: (server: string, detail: string) => void;
  bannedMcpServers?: string[];
}

function detectContamination(e: Record<string, unknown>, bannedServers: string[]): { server: string; detail: string } | null {
  if (e.type !== "tool_call" || e.subtype !== "started") return null;
  const tc = (e.tool_call ?? {}) as Record<string, unknown>;

  const mcpCall = tc.mcpToolCall as Record<string, unknown> | undefined;
  if (mcpCall) {
    const mcp = (mcpCall.args ?? mcpCall) as Record<string, unknown>;
    const server = ((mcp.providerIdentifier ?? mcp.serverName ?? "") as string).toLowerCase();
    for (const banned of bannedServers) {
      if (server.includes(banned.toLowerCase())) {
        const tool = (mcp.toolName ?? "") as string;
        return { server: banned, detail: `MCP:${server}/${tool}` };
      }
    }
  }

  return null;
}

export function processStreamChunk(chunk: string, tag: string, state: StreamState, opts?: StreamOptions): void {
  state.partial += chunk;
  const lines = state.partial.split("\n");
  state.partial = lines.pop() ?? "";
  for (const line of lines) {
    if (!line) continue;
    try {
      const e = JSON.parse(line) as Record<string, unknown>;
      if (e.type === "result" && opts?.onResult) {
        opts.onResult(e);
      } else {
        if (opts?.bannedMcpServers?.length) {
          const hit = detectContamination(e, opts.bannedMcpServers);
          if (hit) {
            log(`[${tag}] ⛔ CONTAMINATION: ${hit.detail} — aborting`);
            opts.onContamination?.(hit.server, hit.detail);
          }
        }
        handleStreamEvent(e, tag, state);
      }
    } catch { /* skip non-JSON */ }
  }
}
