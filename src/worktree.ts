import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { WorktreeInfo } from "./types.js";

const WORKTREE_PREFIX = "ces";

export function createWorktree(repoPath: string, name: string, baseBranch: string): WorktreeInfo {
  const suffix = randomBytes(4).toString("hex");
  const worktreeName = `${WORKTREE_PREFIX}-${name}-${suffix}`;
  const worktreeDir = path.join(os.tmpdir(), "context-engine-sim", worktreeName);

  execSync(`git worktree add -b "${worktreeName}" "${worktreeDir}" "${baseBranch}"`, {
    cwd: repoPath,
    stdio: "pipe",
  });

  return { path: worktreeDir, branch: worktreeName };
}

export function removeWorktree(repoPath: string, info: WorktreeInfo): void {
  try {
    execSync(`git worktree remove --force "${info.path}"`, {
      cwd: repoPath,
      stdio: "pipe",
    });
  } catch {
    try {
      execSync("git worktree prune", { cwd: repoPath, stdio: "pipe" });
    } catch {}
  }
  try {
    execSync(`git branch -D "${info.branch}"`, { cwd: repoPath, stdio: "pipe" });
  } catch {}
}

export function registerCleanupHandler(repoPath: string, worktrees: WorktreeInfo[]): () => void {
  const cleanup = () => {
    for (const wt of worktrees) {
      try {
        removeWorktree(repoPath, wt);
      } catch {}
    }
  };

  const handler = () => {
    cleanup();
    process.exit(1);
  };

  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);

  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}

export function validateGitRepo(repoPath: string): void {
  try {
    execSync("git rev-parse --git-dir", { cwd: repoPath, stdio: "pipe" });
  } catch {
    throw new Error(`Not a git repository: ${repoPath}`);
  }
}

export function getDefaultBranch(repoPath: string): string {
  try {
    const result = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoPath,
      stdio: "pipe",
    });
    return result.toString().trim();
  } catch {
    return "HEAD";
  }
}
