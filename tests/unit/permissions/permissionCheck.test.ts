/**
 * Test: executeTool with PermissionManager integration.
 *
 * Tests the ask decision flow: onPermissionAsk callback, allow/deny decisions,
 * and "Always allow" rule persistence.
 */

import { describe, test, expect, vi } from "vitest";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../src/tools/types.js";
import { PermissionManager } from "../../../src/permissions/manager.js";
import { executeToolWithPermissions, ToolRegistry } from "../../../src/tools/registry.js";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeRegistry(tool: Tool): ToolRegistry {
  const registry = new ToolRegistry();
  // Use register which validates name matches
  (registry as unknown as { tools: Map<string, Tool> }).tools.set(tool.name, tool);
  return registry;
}

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: "Bash",
    description: "Execute shell commands",
    inputSchema: z.strictObject({ command: z.string() }),
    validateInput: vi.fn(async () => ({ ok: true })),
    execute: vi.fn(async () => ({ output: "done" })),
    ...overrides,
  };
}

function makeContext(): ToolContext {
  return {
    workingDirectory: "/test",
    abortSignal: new AbortController().signal,
  };
}

// ──────────────────────────────────────────────
// Without PermissionManager
// ──────────────────────────────────────────────

describe("executeToolWithPermissions — without PermissionManager", () => {
  test("executes tool normally when no PermissionManager", async () => {
    const tool = makeTool();
    const registry = makeRegistry(tool);
    const result = await executeToolWithPermissions(
      registry,
      "Bash",
      { command: "ls" },
      makeContext(),
      new PermissionManager("bypassPermissions"),
    );
    expect(result.output).toBe("done");
    expect(result.error).toBeUndefined();
  });
});

// ──────────────────────────────────────────────
// With PermissionManager — allow
// ──────────────────────────────────────────────

describe("executeToolWithPermissions — allow decision", () => {
  test("executes tool when permission check returns allow", async () => {
    const pm = new PermissionManager();
    pm.addRule({
      source: "session",
      behavior: "allow",
      value: { toolName: "Bash" },
    });

    const tool = makeTool();
    const result = await executeToolWithPermissions(
      makeRegistry(tool),
      "Bash",
      { command: "ls" },
      makeContext(),
      pm,
    );
    expect(result.output).toBe("done");
  });
});

// ──────────────────────────────────────────────
// With PermissionManager — deny
// ──────────────────────────────────────────────

describe("executeToolWithPermissions — deny decision", () => {
  test("returns error when permission check returns deny", async () => {
    const pm = new PermissionManager();
    pm.addRule({
      source: "session",
      behavior: "deny",
      value: { toolName: "Bash" },
    });

    const tool = makeTool();
    const result = await executeToolWithPermissions(
      makeRegistry(tool),
      "Bash",
      { command: "ls" },
      makeContext(),
      pm,
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("denied");
  });
});

// ──────────────────────────────────────────────
// With PermissionManager — ask + callback
// ──────────────────────────────────────────────

describe("executeToolWithPermissions — ask decision", () => {
  test("calls onPermissionAsk when check returns ask and user allows", async () => {
    const pm = new PermissionManager();
    // No rules → default to ask
    const tool = makeTool();

    const onAsk = vi.fn(async () => ({ allowed: true, alwaysAllow: false }));

    const result = await executeToolWithPermissions(
      makeRegistry(tool),
      "Bash",
      { command: "ls" },
      makeContext(),
      pm,
      onAsk,
    );

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "ask" }),
      "Bash",
      { command: "ls" },
    );
    expect(result.output).toBe("done");
  });

  test("returns error when user denies via onPermissionAsk", async () => {
    const pm = new PermissionManager();
    const tool = makeTool();

    const onAsk = vi.fn(async () => ({ allowed: false, alwaysAllow: false }));

    const result = await executeToolWithPermissions(
      makeRegistry(tool),
      "Bash",
      { command: "ls" },
      makeContext(),
      pm,
      onAsk,
    );

    expect(result.error).toBe(true);
    expect(result.output).toContain("denied");
  });

  test("adds session rule when user selects alwaysAllow", async () => {
    const pm = new PermissionManager();
    const tool = makeTool();

    const onAsk = vi.fn(async () => ({ allowed: true, alwaysAllow: true }));

    const result = await executeToolWithPermissions(
      makeRegistry(tool),
      "Bash",
      { command: "ls" },
      makeContext(),
      pm,
      onAsk,
    );

    // Tool should have executed
    expect(result.output).toBe("done");

    // Session rule should be added — next call should auto-allow without onAsk
    const onAsk2 = vi.fn(async () => ({ allowed: true, alwaysAllow: false }));
    const result2 = await executeToolWithPermissions(
      { get: () => tool } as never,
      "Bash",
      { command: "ls -la" },
      makeContext(),
      pm,
      onAsk2,
    );

    expect(onAsk2).not.toHaveBeenCalled();
    expect(result2.output).toBe("done");
  });

  test("returns error when ask decision and no onPermissionAsk callback", async () => {
    const pm = new PermissionManager();
    const tool = makeTool();

    const result = await executeToolWithPermissions(
      makeRegistry(tool),
      "Bash",
      { command: "ls" },
      makeContext(),
      pm,
      // No callback provided
    );

    expect(result.error).toBe(true);
    expect(result.output).toContain("requires permission");
  });
});
