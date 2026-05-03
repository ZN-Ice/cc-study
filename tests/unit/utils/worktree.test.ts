/**
 * Worktree isolation unit tests.
 *
 * Covers: validateWorktreeSlug, createAgentWorktree, removeAgentWorktree,
 * hasWorktreeChanges, helper functions.
 *
 * Uses temporary git repositories for integration-level tests.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, realpathSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import {
  validateWorktreeSlug,
  createAgentWorktree,
  removeAgentWorktree,
  hasWorktreeChanges,
  worktreeBranchName,
} from "../../../src/utils/worktree.js";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createTempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-study-worktree-test-"));
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# Test");
  execSync("git add .", { cwd: dir });
  execSync('git commit -m "initial"', { cwd: dir });
  // Resolve symlinks (macOS /var → /private/var)
  return realpathSync(dir);
}

function cleanupDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}

// ──────────────────────────────────────────────
// validateWorktreeSlug
// ──────────────────────────────────────────────

describe("validateWorktreeSlug", () => {
  test("accepts simple alphanumeric slug", () => {
    expect(() => validateWorktreeSlug("my-agent")).not.toThrow();
  });

  test("accepts slug with underscores and dots", () => {
    expect(() => validateWorktreeSlug("my_agent.v2")).not.toThrow();
  });

  test("accepts nested slug with forward slashes", () => {
    expect(() => validateWorktreeSlug("user/feature")).not.toThrow();
  });

  test("accepts hex slug (agent pattern)", () => {
    expect(() => validateWorktreeSlug("agent-a1b2c3d4")).not.toThrow();
  });

  test("rejects path traversal with ..", () => {
    expect(() => validateWorktreeSlug("../../../etc/passwd")).toThrow();
  });

  test("rejects single .. segment", () => {
    expect(() => validateWorktreeSlug("..")).toThrow();
  });

  test("rejects single . segment", () => {
    expect(() => validateWorktreeSlug(".")).toThrow();
  });

  test("rejects slug that is too long", () => {
    const longSlug = "a".repeat(65);
    expect(() => validateWorktreeSlug(longSlug)).toThrow(/64 characters/);
  });

  test("accepts slug at max length (64 chars)", () => {
    const maxSlug = "a".repeat(64);
    expect(() => validateWorktreeSlug(maxSlug)).not.toThrow();
  });

  test("rejects slug with special characters", () => {
    expect(() => validateWorktreeSlug("my agent")).toThrow();
    expect(() => validateWorktreeSlug("my@agent")).toThrow();
    expect(() => validateWorktreeSlug("my#agent")).toThrow();
  });

  test("rejects empty string", () => {
    expect(() => validateWorktreeSlug("")).toThrow();
  });

  test("rejects slug with only slashes", () => {
    expect(() => validateWorktreeSlug("/")).toThrow();
    expect(() => validateWorktreeSlug("//")).toThrow();
  });

  test("rejects nested slug with .. segment", () => {
    expect(() => validateWorktreeSlug("user/../etc")).toThrow();
  });
});

// ──────────────────────────────────────────────
// worktreeBranchName
// ──────────────────────────────────────────────

describe("worktreeBranchName", () => {
  test("prefixes with worktree-", () => {
    expect(worktreeBranchName("my-agent")).toBe("worktree-my-agent");
  });

  test("flattens nested slugs", () => {
    expect(worktreeBranchName("user/feature")).toBe("worktree-user+feature");
  });
});

// ──────────────────────────────────────────────
// createAgentWorktree + removeAgentWorktree
// ──────────────────────────────────────────────

describe("createAgentWorktree", () => {
  let originalCwd: string;
  let tempRepo: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempRepo = createTempGitRepo();
    process.chdir(tempRepo);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupDir(tempRepo);
  });

  test("creates worktree in .claude/worktrees/", async () => {
    const result = await createAgentWorktree("test-agent");

    expect(result.worktreePath).toContain(".claude/worktrees");
    expect(existsSync(result.worktreePath)).toBe(true);
    expect(result.worktreeBranch).toBeTruthy();
    expect(result.headCommit).toBeTruthy();
    expect(result.gitRoot).toBe(tempRepo);
  });

  test("worktree has the same files as main repo", async () => {
    const result = await createAgentWorktree("test-agent");

    expect(existsSync(join(result.worktreePath, "README.md"))).toBe(true);
  });

  test("worktree is on its own branch", async () => {
    const result = await createAgentWorktree("test-agent");

    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: result.worktreePath,
      encoding: "utf-8",
    }).trim();

    expect(branch).toBe(result.worktreeBranch);
  });

  test("reuses existing worktree on second call", async () => {
    const result1 = await createAgentWorktree("reuse-test");
    const result2 = await createAgentWorktree("reuse-test");

    expect(result1.worktreePath).toBe(result2.worktreePath);
  });

  test("throws for invalid slug", async () => {
    await expect(createAgentWorktree("../../../evil")).rejects.toThrow();
  });
});

describe("removeAgentWorktree", () => {
  let originalCwd: string;
  let tempRepo: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempRepo = createTempGitRepo();
    process.chdir(tempRepo);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupDir(tempRepo);
  });

  test("removes worktree directory", async () => {
    const created = await createAgentWorktree("remove-test");
    const worktreePath = created.worktreePath;

    expect(existsSync(worktreePath)).toBe(true);

    const removed = await removeAgentWorktree(
      worktreePath,
      created.worktreeBranch,
      created.gitRoot,
    );

    expect(removed).toBe(true);
    expect(existsSync(worktreePath)).toBe(false);
  });

  test("returns false when git root is not provided for git worktree", async () => {
    const result = await removeAgentWorktree("/tmp/nonexistent", undefined, undefined);
    expect(result).toBe(false);
  });

  test("removes worktree branch", async () => {
    const created = await createAgentWorktree("branch-del-test");

    await removeAgentWorktree(
      created.worktreePath,
      created.worktreeBranch,
      created.gitRoot,
    );

    // Branch should be deleted
    const branches = execSync("git branch --list", {
      cwd: created.gitRoot,
      encoding: "utf-8",
    });

    expect(branches).not.toContain(created.worktreeBranch!);
  });
});

// ──────────────────────────────────────────────
// hasWorktreeChanges
// ──────────────────────────────────────────────

describe("hasWorktreeChanges", () => {
  let originalCwd: string;
  let tempRepo: string;
  let headCommit: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempRepo = createTempGitRepo();
    headCommit = execSync("git rev-parse HEAD", {
      cwd: tempRepo,
      encoding: "utf-8",
    }).trim();
    process.chdir(tempRepo);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupDir(tempRepo);
  });

  test("returns false for clean worktree", async () => {
    const created = await createAgentWorktree("clean-test");

    const hasChanges = await hasWorktreeChanges(created.worktreePath, headCommit);
    expect(hasChanges).toBe(false);
  });

  test("returns false when only .claude/settings.local.json exists (setup artifact)", async () => {
    const created = await createAgentWorktree("settings-artifact-test");

    // Simulate performPostCreationSetup copying settings.local.json
    const settingsDir = join(created.worktreePath, ".claude");
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, "settings.local.json"), '{"permissions":{}}');

    // Should NOT detect this as a change — it's a setup artifact
    const hasChanges = await hasWorktreeChanges(created.worktreePath, headCommit);
    expect(hasChanges).toBe(false);
  });

  test("returns true when worktree has uncommitted files", async () => {
    const created = await createAgentWorktree("dirty-test");

    writeFileSync(join(created.worktreePath, "new-file.txt"), "dirty");

    const hasChanges = await hasWorktreeChanges(created.worktreePath, headCommit);
    expect(hasChanges).toBe(true);
  });

  test("returns true when worktree has new commits", async () => {
    const created = await createAgentWorktree("commit-test");

    writeFileSync(join(created.worktreePath, "new-file.txt"), "new content");
    execSync("git add .", { cwd: created.worktreePath });
    execSync('git commit -m "new commit"', { cwd: created.worktreePath });

    const hasChanges = await hasWorktreeChanges(created.worktreePath, headCommit);
    expect(hasChanges).toBe(true);
  });

  test("returns true for invalid path (fail-closed)", async () => {
    const hasChanges = await hasWorktreeChanges("/nonexistent/path", "abc123");
    expect(hasChanges).toBe(true);
  });
});
