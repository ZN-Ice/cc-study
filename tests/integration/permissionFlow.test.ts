/**
 * Integration test for the permission system.
 *
 * Tests the full permission flow without React hooks:
 * executeToolWithPermissions → PermissionManager → BashTool.checkPermissions
 *
 * Covers: allow rules, deny rules, ask+user response, bypass mode,
 * plan mode, always-allow session rule.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ToolContext } from "../../src/tools/types.js";

// ── Setup helper ────────────────────────────────────────────────────

interface SetupResult {
  tmpDir: string;
  ctx: ToolContext;
  executeToolWithPermissions: typeof import("../../src/tools/registry.js").executeToolWithPermissions;
  registry: import("../../src/tools/registry.js").ToolRegistry;
  pm: import("../../src/permissions/manager.js").PermissionManager;
}

async function setupPermissionTest(
  permissionMode?: "default" | "bypassPermissions" | "plan",
  allowRules?: string[],
  denyRules?: string[],
): Promise<SetupResult> {
  const { createDefaultRegistry } = await import("../../src/tools/index.js");
  const { PermissionManager } = await import("../../src/permissions/manager.js");
  const { executeToolWithPermissions } = await import("../../src/tools/registry.js");

  const registry = createDefaultRegistry();
  const tmpDir = mkdtempSync(join(tmpdir(), "cc-study-perm-"));
  const ctx: ToolContext = {
    workingDirectory: tmpDir,
    abortSignal: new AbortController().signal,
  };

  const pm = new PermissionManager(permissionMode);
  if (allowRules || denyRules) {
    pm.loadFromConfig({ allow: allowRules, deny: denyRules }, "session");
  }

  return { tmpDir, ctx, executeToolWithPermissions, registry, pm };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Permission integration", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  // ── Allow rules ────────────────────────────────────────────────

  test("Read tool auto-allowed by rule, executes without ask", async () => {
    const s = await setupPermissionTest("default", ["Read"]);
    tmpDirs.push(s.tmpDir);

    const testFile = join(s.tmpDir, "data.txt");
    writeFileSync(testFile, "permission-test-data");

    const result = await s.executeToolWithPermissions(
      s.registry, "Read", { file_path: testFile }, s.ctx, s.pm,
    );

    expect(result.output).toContain("permission-test-data");
    expect(result.error).toBeFalsy();
  });

  // ── Deny rules ────────────────────────────────────────────────

  test("Bash tool denied by rule, returns error without executing", async () => {
    const s = await setupPermissionTest("default", undefined, ["Bash"]);
    tmpDirs.push(s.tmpDir);

    const result = await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "echo hello" }, s.ctx, s.pm,
    );

    expect(result.output).toContain("denied");
    expect(result.error).toBe(true);
  });

  // ── Deny with content pattern ──────────────────────────────────

  test("Bash deny rule with pattern blocks matching commands only", async () => {
    const s = await setupPermissionTest("default", ["Bash(echo*)"], ["Bash(rm*)"]);
    tmpDirs.push(s.tmpDir);

    // echo should succeed
    const resultEcho = await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "echo allowed" }, s.ctx, s.pm,
    );
    expect(resultEcho.output).toContain("allowed");
    expect(resultEcho.error).toBeFalsy();

    // rm should be denied
    const resultRm = await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "rm -rf something" }, s.ctx, s.pm,
    );
    expect(resultRm.output).toContain("denied");
    expect(resultRm.error).toBe(true);
  });

  // ── Ask + user allows ─────────────────────────────────────────

  test("Ask decision: user allows via onPermissionAsk", async () => {
    const s = await setupPermissionTest("default");
    tmpDirs.push(s.tmpDir);

    const onAsk = vi.fn(async () => ({ allowed: true, alwaysAllow: false }));

    // Use a write command (mkdir) that is NOT read-only, so it triggers ask
    const result = await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "mkdir -p /tmp/cc-ask-test" }, s.ctx, s.pm, onAsk,
    );

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(result.error).toBeFalsy();
  });

  // ── Ask + user denies ─────────────────────────────────────────

  test("Ask decision: user denies via onPermissionAsk", async () => {
    const s = await setupPermissionTest("default");
    tmpDirs.push(s.tmpDir);

    const onAsk = vi.fn(async () => ({ allowed: false, alwaysAllow: false }));

    // Use a write command (mkdir) to trigger ask
    const result = await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "mkdir /tmp/cc-deny-test" }, s.ctx, s.pm, onAsk,
    );

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(result.output).toContain("denied by user");
    expect(result.error).toBe(true);
  });

  // ── Ask + always allow ────────────────────────────────────────

  test("Ask decision: always allow creates session rule, subsequent calls skip ask", async () => {
    const s = await setupPermissionTest("default");
    tmpDirs.push(s.tmpDir);

    let askCount = 0;
    const onAsk = vi.fn(async () => {
      askCount++;
      return { allowed: true, alwaysAllow: true };
    });

    // First call — should ask (mkdir is not read-only)
    const result1 = await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "mkdir -p /tmp/cc-always-test-1" }, s.ctx, s.pm, onAsk,
    );
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(result1.error).toBeFalsy();

    // Second call — should NOT ask (session rule was added)
    const result2 = await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "mkdir -p /tmp/cc-always-test-2" }, s.ctx, s.pm, onAsk,
    );
    expect(onAsk).toHaveBeenCalledTimes(1); // not called again
    expect(result2.error).toBeFalsy();
  });

  // ── Bypass mode ───────────────────────────────────────────────

  test("bypassPermissions mode: tools execute without asking", async () => {
    const s = await setupPermissionTest("bypassPermissions");
    tmpDirs.push(s.tmpDir);

    const onAsk = vi.fn(async () => ({ allowed: true, alwaysAllow: false }));

    const result = await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "echo bypass" }, s.ctx, s.pm, onAsk,
    );

    expect(result.output).toContain("bypass");
    expect(result.error).toBeFalsy();
    expect(onAsk).not.toHaveBeenCalled();
  });

  // ── Plan mode ─────────────────────────────────────────────────

  test("plan mode: read tools auto-allowed, write tools ask", async () => {
    const s = await setupPermissionTest("plan");
    tmpDirs.push(s.tmpDir);

    const testFile = join(s.tmpDir, "plan-test.txt");
    writeFileSync(testFile, "plan mode content");

    // Read tool — should auto-allow in plan mode
    const readResult = await s.executeToolWithPermissions(
      s.registry, "Read", { file_path: testFile }, s.ctx, s.pm,
    );
    expect(readResult.output).toContain("plan mode content");
    expect(readResult.error).toBeFalsy();

    // Write tool — should ask in plan mode
    const onAsk = vi.fn(async () => ({ allowed: false, alwaysAllow: false }));

    const writeResult = await s.executeToolWithPermissions(
      s.registry, "Write", {
        file_path: join(s.tmpDir, "new.txt"),
        content: "new file",
      }, s.ctx, s.pm, onAsk,
    );
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(writeResult.output).toContain("denied by user");
    expect(writeResult.error).toBe(true);
  });

  // ── BashTool.checkPermissions: always block ──────────────────

  test("BashTool checkPermissions: rm -rf / blocked even in bypass mode", async () => {
    const s = await setupPermissionTest("bypassPermissions");
    tmpDirs.push(s.tmpDir);

    const result = await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "rm -rf /" }, s.ctx, s.pm,
    );

    expect(result.output).toContain("blocked");
    expect(result.error).toBe(true);
  });

  // ── Read-only bash auto-allow ───────────────────────────────

  test("Read-only bash commands auto-allowed without asking", async () => {
    const s = await setupPermissionTest("default");
    tmpDirs.push(s.tmpDir);

    const onAsk = vi.fn(async () => ({ allowed: true, alwaysAllow: false }));

    // ls, cat, git status — all read-only, should auto-allow
    const result = await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "ls" }, s.ctx, s.pm, onAsk,
    );

    expect(onAsk).not.toHaveBeenCalled();
    expect(result.error).toBeFalsy();
  });

  // ── BashTool.checkPermissions: force ask ─────────────────────

  test("BashTool checkPermissions: sudo command triggers ask even in bypass mode", async () => {
    const s = await setupPermissionTest("bypassPermissions");
    tmpDirs.push(s.tmpDir);

    const onAsk = vi.fn(async () => ({ allowed: false, alwaysAllow: false }));

    const result = await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "sudo echo something" }, s.ctx, s.pm, onAsk,
    );

    // Even in bypass mode, sudo should trigger ask from checkPermissions
    expect(onAsk).toHaveBeenCalledTimes(1);
    // User denied, so it should be an error
    expect(result.output).toContain("denied by user");
    expect(result.error).toBe(true);
  });

  // ── No onPermissionAsk callback ──────────────────────────────

  test("Ask decision without onPermissionAsk callback returns error", async () => {
    const s = await setupPermissionTest("default");
    tmpDirs.push(s.tmpDir);

    // Use a write command (mkdir) to trigger ask, no callback
    const result = await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "mkdir /tmp/cc-no-callback-test" }, s.ctx, s.pm,
    );

    expect(result.output).toContain("requires permission");
    expect(result.error).toBe(true);
  });

  // ── Glob/Grep auto-allowed ───────────────────────────────────

  test("Glob and Grep auto-allowed by rules", async () => {
    const s = await setupPermissionTest("default", ["Glob", "Grep"]);
    tmpDirs.push(s.tmpDir);

    writeFileSync(join(s.tmpDir, "test.txt"), "hello world");

    const globResult = await s.executeToolWithPermissions(
      s.registry, "Glob", { pattern: "*.txt", path: s.tmpDir }, s.ctx, s.pm,
    );
    expect(globResult.output).toContain("test.txt");
    expect(globResult.error).toBeFalsy();

    const grepResult = await s.executeToolWithPermissions(
      s.registry, "Grep", { pattern: "hello", path: s.tmpDir }, s.ctx, s.pm,
    );
    expect(grepResult.output).toContain("test.txt");
    expect(grepResult.error).toBeFalsy();
  });

  // ── Always-allow persistence ─────────────────────────────────

  test("always-allow persists rule to .claude/settings.json", async () => {
    const s = await setupPermissionTest("default");
    tmpDirs.push(s.tmpDir);

    const onAsk = vi.fn(async () => ({ allowed: true, alwaysAllow: true }));

    // Use a write command to trigger ask
    const result = await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "mkdir -p /tmp/cc-persist-test" }, s.ctx, s.pm, onAsk,
    );

    expect(result.error).toBeFalsy();

    // Wait for fire-and-forget write to complete
    await new Promise((r) => setTimeout(r, 100));

    // Check that .claude/settings.json was created with the rule
    const settingsPath = join(s.tmpDir, ".claude", "settings.json");
    const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(raw.permissions.allow).toBeDefined();
    expect(raw.permissions.allow).toContain("Bash");
  });

  test("always-allow with ruleContent persists pattern to file", async () => {
    const s = await setupPermissionTest("default");
    tmpDirs.push(s.tmpDir);

    // Mock pm.check to return ask with content-specific rule reason
    const contentRule = {
      source: "userSettings",
      behavior: "ask" as const,
      value: { toolName: "Bash", ruleContent: "git*" },
    };

    vi.spyOn(s.pm, "check").mockResolvedValue({
      behavior: "ask",
      message: "Requires permission",
      reason: { type: "rule", rule: contentRule },
    });

    const onAsk = vi.fn(async () => ({ allowed: true, alwaysAllow: true }));
    await s.executeToolWithPermissions(
      s.registry, "Bash", { command: "git status" }, s.ctx, s.pm, onAsk,
    );

    await new Promise((r) => setTimeout(r, 100));

    const settingsPath = join(s.tmpDir, ".claude", "settings.json");
    const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(raw.permissions.allow).toContain("Bash(git*)");
  });
});
