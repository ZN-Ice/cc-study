/**
 * Git worktree isolation for sub-agents.
 *
 * References: free-code/src/utils/worktree.ts
 *
 * Each sub-agent can optionally work in an isolated git worktree — a separate
 * working copy of the same repository. This prevents concurrent agents from
 * modifying the same files and provides a clean rollback path.
 *
 * Simplifications vs reference source:
 * - No hook-based worktree creation (git-only)
 * - No sparse-checkout support
 * - No tmux integration
 * - No .worktreeinclude file copying
 * - No stale worktree auto-cleanup
 */

import { mkdir, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, execSync } from "node:child_process";

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const VALID_WORKTREE_SLUG_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const MAX_WORKTREE_SLUG_LENGTH = 64;

// ──────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────

/**
 * Validate a worktree slug to prevent path traversal and directory escape.
 *
 * Forward slashes are allowed for nesting (e.g. `user/feature`);
 * each segment is validated independently.
 */
export function validateWorktreeSlug(slug: string): void {
  if (slug.length > MAX_WORKTREE_SLUG_LENGTH) {
    throw new Error(
      `Invalid worktree name: must be ${MAX_WORKTREE_SLUG_LENGTH} characters or fewer (got ${slug.length})`,
    );
  }
  for (const segment of slug.split("/")) {
    if (segment === "." || segment === "..") {
      throw new Error(
        `Invalid worktree name "${slug}": must not contain "." or ".." path segments`,
      );
    }
    if (!VALID_WORKTREE_SLUG_SEGMENT.test(segment)) {
      throw new Error(
        `Invalid worktree name "${slug}": each "/"-separated segment must be non-empty and contain only letters, digits, dots, underscores, and dashes`,
      );
    }
  }
}

// ──────────────────────────────────────────────
// Path Helpers
// ──────────────────────────────────────────────

/**
 * Flatten nested slugs (`user/feature` → `user+feature`) for branch names
 * and directory paths to avoid git ref D/F conflicts and nested directories.
 */
function flattenSlug(slug: string): string {
  return slug.replaceAll("/", "+");
}

/** Generate a worktree branch name from a slug. */
export function worktreeBranchName(slug: string): string {
  return `worktree-${flattenSlug(slug)}`;
}

/** Compute the worktree directory path. */
function worktreePathFor(repoRoot: string, slug: string): string {
  return join(repoRoot, ".claude", "worktrees", flattenSlug(slug));
}

/** Ensure a directory exists (recursive). */
async function mkdirRecursive(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Find the git repository root by walking upward from `startDir`.
 */
function findGitRoot(startDir: string): string | null {
  try {
    const result = execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
// Git Helpers
// ──────────────────────────────────────────────

/**
 * Get the default branch name (main or master).
 */
function getDefaultBranch(cwd: string): string {
  try {
    const result = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // Output: refs/remotes/origin/main
    return result.replace("refs/remotes/origin/", "");
  } catch {
    return "main";
  }
}

/**
 * Run a git command, returning { stdout, success }.
 * Uses execFileSync to avoid shell interpretation of special characters.
 */
function runGit(args: string[], cwd: string): { stdout: string; success: boolean } {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" },
    });
    return { stdout, success: true };
  } catch {
    return { stdout: "", success: false };
  }
}

// ──────────────────────────────────────────────
// Post-Creation Setup
// ──────────────────────────────────────────────

/**
 * Post-creation setup for a newly created worktree.
 * Copies settings.local.json if it exists.
 */
async function performPostCreationSetup(
  repoRoot: string,
  worktreePath: string,
): Promise<void> {
  const localSettingsPath = join(repoRoot, ".claude", "settings.local.json");
  if (existsSync(localSettingsPath)) {
    const destPath = join(worktreePath, ".claude", "settings.local.json");
    await mkdirRecursive(join(worktreePath, ".claude"));
    const { copyFile } = await import("node:fs/promises");
    await copyFile(localSettingsPath, destPath);
  }
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

export interface AgentWorktreeInfo {
  worktreePath: string;
  worktreeBranch?: string;
  headCommit?: string;
  gitRoot?: string;
}

/**
 * Create a lightweight worktree for a sub-agent.
 *
 * Creates a new git worktree (or resumes an existing one) and runs
 * post-creation setup. Does NOT touch global session state.
 */
export async function createAgentWorktree(slug: string): Promise<AgentWorktreeInfo> {
  validateWorktreeSlug(slug);

  const cwd = process.cwd();
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) {
    throw new Error(
      "Cannot create agent worktree: not in a git repository. " +
        "Ensure you are running from within a git repository.",
    );
  }

  const worktreePath = worktreePathFor(gitRoot, slug);
  const branchName = worktreeBranchName(slug);

  // Fast resume: check if worktree already exists
  if (existsSync(join(worktreePath, ".git"))) {
    const { stdout: headSha, success } = runGit(["rev-parse", "HEAD"], worktreePath);
    if (success && headSha.trim()) {
      // Bump mtime so stale-worktree cleanup doesn't consider this stale
      try {
        await utimes(worktreePath, new Date(), new Date());
      } catch {
        // ignore — non-critical
      }
      return {
        worktreePath,
        worktreeBranch: branchName,
        headCommit: headSha.trim(),
        gitRoot,
      };
    }
  }

  // New worktree: ensure worktrees directory exists
  await mkdirRecursive(join(gitRoot, ".claude", "worktrees"));

  // Determine base branch and SHA
  const defaultBranch = getDefaultBranch(gitRoot);
  const { stdout: baseSha, success: shaOk } = runGit(
    ["rev-parse", `origin/${defaultBranch}`],
    gitRoot,
  );

  let effectiveBase: string;
  if (shaOk && baseSha.trim()) {
    effectiveBase = `origin/${defaultBranch}`;
  } else {
    effectiveBase = "HEAD";
  }

  // Create worktree: -B resets any orphan branch
  const addResult = runGit(
    ["worktree", "add", "-B", branchName, worktreePath, effectiveBase],
    gitRoot,
  );
  if (!addResult.success) {
    throw new Error(`Failed to create worktree: ${addResult.stdout}`);
  }

  // Get the actual HEAD commit of the new worktree
  const { stdout: headCommit } = runGit(["rev-parse", "HEAD"], worktreePath);

  // Post-creation setup
  await performPostCreationSetup(gitRoot, worktreePath);

  return {
    worktreePath,
    worktreeBranch: branchName,
    headCommit: headCommit.trim() || undefined,
    gitRoot,
  };
}

/**
 * Remove a worktree created by createAgentWorktree.
 *
 * For git-based worktrees: removes the worktree directory and deletes the branch.
 * Must be called with the main repo's git root, not the worktree path.
 */
export async function removeAgentWorktree(
  worktreePath: string,
  worktreeBranch?: string,
  gitRoot?: string,
): Promise<boolean> {
  if (!gitRoot) {
    return false;
  }

  // Remove the worktree directory
  const { success: removeOk } = runGit(
    ["worktree", "remove", "--force", worktreePath],
    gitRoot,
  );

  if (!removeOk) {
    return false;
  }

  // Delete the temporary worktree branch
  if (worktreeBranch) {
    runGit(["branch", "-D", worktreeBranch], gitRoot);
  }

  return true;
}

/**
 * Check whether a worktree has uncommitted changes or new commits since creation.
 *
 * Returns true if:
 * - Working directory has uncommitted changes (dirty)
 * - Commits were made since `headCommit`
 * - Git commands fail (fail-closed)
 *
 * Ignores .claude/settings.local.json — this file is copied by
 * performPostCreationSetup and is not tracked by git. Without this
 * exclusion, the copied file would always register as "uncommitted",
 * preventing automatic worktree cleanup.
 */
/** Files/patterns that are setup artifacts and should be ignored by change detection. */
const SETUP_ARTIFACTS = new Set([".claude/settings.local.json"]);

export async function hasWorktreeChanges(
  worktreePath: string,
  headCommit: string,
): Promise<boolean> {
  // Check for uncommitted changes
  const { stdout: statusOutput, success: statusOk } = runGit(
    ["status", "--porcelain"],
    worktreePath,
  );
  if (!statusOk) return true;

  // Filter out setup artifacts (e.g. .claude/settings.local.json copied by
  // performPostCreationSetup). These are not tracked by git and would always
  // register as "uncommitted", preventing automatic worktree cleanup.
  const meaningfulChanges = statusOutput
    .trim()
    .split("\n")
    .filter((line) => {
      if (line.length === 0) return false;
      // status format: XY filename (2-char prefix + space + path)
      const filePath = line.substring(3);
      return !SETUP_ARTIFACTS.has(filePath);
    });

  if (meaningfulChanges.length > 0) return true;

  // Check for new commits since headCommit
  const { stdout: revListOutput, success: revListOk } = runGit(
    ["rev-list", "--count", `${headCommit}..HEAD`],
    worktreePath,
  );
  if (!revListOk) return true;
  if (parseInt(revListOutput.trim(), 10) > 0) return true;

  return false;
}
