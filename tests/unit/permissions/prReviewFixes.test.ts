/**
 * PR Review Fixes — Verification Tests
 *
 * Targeted tests to verify the three PR review issues are correctly fixed:
 *
 * 1. parseRuleString regex: `\w+` → `[^()]+` for MCP tool name support
 * 2. onPermissionAsk: safe type guards instead of unsafe `in` check
 * 3. Always-allow: preserve ruleContent from decision.reason
 */

import { describe, test, expect, vi } from "vitest";
import { z } from "zod";
import { parseRuleString, PermissionManager } from "../../../src/permissions/manager.js";
import { executeToolWithPermissions, ToolRegistry } from "../../../src/tools/registry.js";
import type { Tool, ToolContext } from "../../../src/tools/types.js";
import type { PermissionDecision, PermissionRule } from "../../../src/permissions/types.js";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeRegistry(tool: Tool): ToolRegistry {
  const registry = new ToolRegistry();
  (registry as unknown as { tools: Map<string, Tool> }).tools.set(tool.name, tool);
  return registry;
}

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: "Bash",
    description: "Execute shell commands",
    inputSchema: z.strictObject({ command: z.string() }),
    validateInput: vi.fn(async () => ({ ok: true })),
    execute: vi.fn(async () => ({ output: "executed" })),
    ...overrides,
  };
}

function makeContext(): ToolContext {
  return {
    workingDirectory: "/test",
    abortSignal: new AbortController().signal,
  };
}

// ══════════════════════════════════════════════
// Fix 1: parseRuleString regex for MCP tool names
// ══════════════════════════════════════════════

describe("PR Fix #1: parseRuleString regex supports MCP tool names", () => {
  test("parses MCP tool name with double underscores (no content)", () => {
    expect(parseRuleString("mcp__my_server__read_file")).toEqual({
      toolName: "mcp__my_server__read_file",
      ruleContent: undefined,
    });
  });

  test("parses MCP tool name with content pattern", () => {
    expect(parseRuleString("mcp__my_server__read_file(/etc/*)")).toEqual({
      toolName: "mcp__my_server__read_file",
      ruleContent: "/etc/*",
    });
  });

  test("parses MCP tool name with dashes in server name", () => {
    expect(parseRuleString("mcp__my-server_v2__tool")).toEqual({
      toolName: "mcp__my-server_v2__tool",
      ruleContent: undefined,
    });
  });

  test("parses MCP tool name with dots in server name", () => {
    expect(parseRuleString("mcp__server.v3__tool")).toEqual({
      toolName: "mcp__server.v3__tool",
      ruleContent: undefined,
    });
  });

  test("parses MCP tool with complex glob pattern containing spaces", () => {
    expect(parseRuleString("mcp__db__query(SELECT * FROM*)")).toEqual({
      toolName: "mcp__db__query",
      ruleContent: "SELECT * FROM*",
    });
  });

  test("loadFromConfig correctly creates rules for MCP tools", async () => {
    const pm = new PermissionManager();
    pm.loadFromConfig({
      allow: [
        "mcp__github__create_issue",
        "mcp__github__read_file(src/**)",
      ],
    }, "userSettings");

    const ctx = pm.getContext();
    expect(ctx.allowRules).toHaveLength(2);
    expect(ctx.allowRules[0].value.toolName).toBe("mcp__github__create_issue");
    expect(ctx.allowRules[0].value.ruleContent).toBeUndefined();
    expect(ctx.allowRules[1].value.toolName).toBe("mcp__github__read_file");
    expect(ctx.allowRules[1].value.ruleContent).toBe("src/**");
  });

  test("MCP tool allow rule actually allows matching tool via permission check", async () => {
    const pm = new PermissionManager();
    pm.loadFromConfig({
      allow: ["mcp__server__tool1"],
    }, "session");

    const mcpTool = makeTool({ name: "mcp__server__tool1" });
    const decision = await pm.check(mcpTool, {}, makeContext());
    expect(decision.behavior).toBe("allow");
  });

  test("MCP tool deny rule actually denies matching tool via permission check", async () => {
    const pm = new PermissionManager();
    pm.loadFromConfig({
      deny: ["mcp__server__tool1"],
    }, "session");

    const mcpTool = makeTool({ name: "mcp__server__tool1" });
    const decision = await pm.check(mcpTool, {}, makeContext());
    expect(decision.behavior).toBe("deny");
  });
});

// ══════════════════════════════════════════════
// Fix 2: onPermissionAsk safe type guards
// ══════════════════════════════════════════════

describe("PR Fix #2: onPermissionAsk handles all decision.reason types safely", () => {
  /**
   * Simulates the onPermissionAsk logic from useStreamResponse.ts
   * to verify the type guard works correctly.
   */
  function extractToolName(decision: PermissionDecision): string {
    let toolName = "Unknown";
    if (
      decision.reason != null &&
      typeof decision.reason === "object" &&
      "type" in decision.reason
    ) {
      const reason = decision.reason as { type: string; toolName?: string };
      if ("toolName" in reason && typeof reason.toolName === "string") {
        toolName = reason.toolName;
      }
    }
    return toolName;
  }

  test("extracts toolName from toolCheck reason", () => {
    const decision: PermissionDecision = {
      behavior: "allow",
      reason: { type: "toolCheck", toolName: "Bash" },
    };
    expect(extractToolName(decision)).toBe("Bash");
  });

  test("extracts toolName from mode reason (no toolName field)", () => {
    const decision: PermissionDecision = {
      behavior: "allow",
      reason: { type: "mode", mode: "bypassPermissions" },
    };
    expect(extractToolName(decision)).toBe("Unknown");
  });

  test("handles default reason (plain object without toolName)", () => {
    const decision: PermissionDecision = {
      behavior: "ask",
      message: "Test",
      reason: { type: "default" },
    };
    expect(extractToolName(decision)).toBe("Unknown");
  });

  test("handles reason that is null", () => {
    const decision: PermissionDecision = {
      behavior: "ask",
      reason: null,
    };
    expect(() => extractToolName(decision)).not.toThrow();
    expect(extractToolName(decision)).toBe("Unknown");
  });

  test("handles reason that is undefined", () => {
    const decision: PermissionDecision = {
      behavior: "ask",
      reason: undefined,
    };
    expect(() => extractToolName(decision)).not.toThrow();
    expect(extractToolName(decision)).toBe("Unknown");
  });

  test("handles reason that is a string (unexpected type)", () => {
    const decision = {
      behavior: "ask" as const,
      reason: "some string reason",
    };
    expect(() => extractToolName(decision as PermissionDecision)).not.toThrow();
    expect(extractToolName(decision as PermissionDecision)).toBe("Unknown");
  });

  test("handles reason that is a number (unexpected type)", () => {
    const decision = {
      behavior: "ask" as const,
      reason: 42,
    };
    expect(() => extractToolName(decision as PermissionDecision)).not.toThrow();
    expect(extractToolName(decision as PermissionDecision)).toBe("Unknown");
  });

  test("handles reason that is a boolean (unexpected type)", () => {
    const decision = {
      behavior: "ask" as const,
      reason: true,
    };
    // `typeof true === "object"` is false (boolean is primitive), so it falls through
    expect(() => extractToolName(decision as PermissionDecision)).not.toThrow();
    expect(extractToolName(decision as PermissionDecision)).toBe("Unknown");
  });
});

// ══════════════════════════════════════════════
// Fix 3: Always-allow preserves ruleContent
// ══════════════════════════════════════════════

describe("PR Fix #3: always-allow preserves ruleContent from decision.reason", () => {
  test("always-allow from default ask creates broad tool-level rule (no ruleContent)", async () => {
    const pm = new PermissionManager();
    const tool = makeTool();

    // No rules → default ask. User says "always allow".
    const onAsk = vi.fn(async () => ({ allowed: true, alwaysAllow: true }));

    await executeToolWithPermissions(
      makeRegistry(tool), "Bash", { command: "ls" }, makeContext(), pm, onAsk,
    );

    const rules = pm.getContext().allowRules;
    expect(rules).toHaveLength(1);
    expect(rules[0].value.toolName).toBe("Bash");
    expect(rules[0].value.ruleContent).toBeUndefined();
  });

  test("always-allow from default ask auto-allows all commands for that tool", async () => {
    const pm = new PermissionManager();
    const tool = makeTool();

    const onAsk = vi.fn(async () => ({ allowed: true, alwaysAllow: true }));
    await executeToolWithPermissions(
      makeRegistry(tool), "Bash", { command: "ls" }, makeContext(), pm, onAsk,
    );

    // Any subsequent Bash command should be auto-allowed
    const onAsk2 = vi.fn(async () => ({ allowed: true, alwaysAllow: false }));
    const result2 = await executeToolWithPermissions(
      makeRegistry(tool), "Bash", { command: "rm -rf something" }, makeContext(), pm, onAsk2,
    );
    expect(onAsk2).not.toHaveBeenCalled();
    expect(result2.output).toBe("executed");
  });

  test("always-allow from toolCheck reason creates broad rule (no ruleContent)", async () => {
    const pm = new PermissionManager();
    const tool = makeTool({
      checkPermissions: vi.fn(async () => ({
        behavior: "ask" as const,
        message: "Sensitive command",
        reason: { type: "safetyCheck" as const, reason: "sudo" },
      })),
    });

    const onAsk = vi.fn(async () => ({ allowed: true, alwaysAllow: true }));
    await executeToolWithPermissions(
      makeRegistry(tool), "Bash", { command: "sudo ls" }, makeContext(), pm, onAsk,
    );

    const rules = pm.getContext().allowRules;
    expect(rules).toHaveLength(1);
    expect(rules[0].value.toolName).toBe("Bash");
    expect(rules[0].value.ruleContent).toBeUndefined();
  });

  test("always-allow from content-specific rule reason preserves ruleContent", async () => {
    const pm = new PermissionManager();
    const tool = makeTool();

    // Use a content-specific ask rule: ask for all Bash commands matching "rm*"
    // Note: current decision chain only supports tool-level ask rules.
    // To test the ruleContent preservation code path, we mock pm.check()
    // to return a decision with a content-specific rule reason.
    const contentRule: PermissionRule = {
      source: "userSettings",
      behavior: "ask",
      value: { toolName: "Bash", ruleContent: "rm*" },
    };

    vi.spyOn(pm, "check").mockResolvedValue({
      behavior: "ask",
      message: "Requires permission",
      reason: { type: "rule", rule: contentRule },
    });

    const onAsk = vi.fn(async () => ({ allowed: true, alwaysAllow: true }));
    await executeToolWithPermissions(
      makeRegistry(tool), "Bash", { command: "rm file.txt" }, makeContext(), pm, onAsk,
    );

    // Session rule should preserve ruleContent "rm*"
    const rules = pm.getContext().allowRules;
    const sessionRule = rules.find(
      (r) => r.source === "session" && r.value.ruleContent === "rm*",
    );
    expect(sessionRule).toBeDefined();
    expect(sessionRule!.value.toolName).toBe("Bash");
    expect(sessionRule!.value.ruleContent).toBe("rm*");
  });

  test("preserved ruleContent only auto-allows matching commands", async () => {
    const pm = new PermissionManager();
    const tool = makeTool();

    // First call: mock check to return content-specific ask for "rm*"
    const contentRule: PermissionRule = {
      source: "userSettings",
      behavior: "ask",
      value: { toolName: "Bash", ruleContent: "rm*" },
    };

    const checkSpy = vi.spyOn(pm, "check").mockResolvedValue({
      behavior: "ask",
      message: "Requires permission",
      reason: { type: "rule", rule: contentRule },
    });

    const onAsk1 = vi.fn(async () => ({ allowed: true, alwaysAllow: true }));
    await executeToolWithPermissions(
      makeRegistry(tool), "Bash", { command: "rm file.txt" }, makeContext(), pm, onAsk1,
    );
    expect(onAsk1).toHaveBeenCalledTimes(1);

    // Restore real check so subsequent calls go through normal decision chain
    checkSpy.mockRestore();

    // "rm other.txt" should be auto-allowed by session rule Bash(rm*)
    const onAsk2 = vi.fn(async () => ({ allowed: true, alwaysAllow: false }));
    const result2 = await executeToolWithPermissions(
      makeRegistry(tool), "Bash", { command: "rm other.txt" }, makeContext(), pm, onAsk2,
    );
    expect(onAsk2).not.toHaveBeenCalled();
    expect(result2.output).toBe("executed");

    // "echo hello" should still ask — doesn't match "rm*"
    const onAsk3 = vi.fn(async () => ({ allowed: true, alwaysAllow: false }));
    const result3 = await executeToolWithPermissions(
      makeRegistry(tool), "Bash", { command: "echo hello" }, makeContext(), pm, onAsk3,
    );
    expect(onAsk3).toHaveBeenCalledTimes(1);
    expect(result3.output).toBe("executed");
  });

  test("always-allow from rule reason without ruleContent creates broad rule", async () => {
    const pm = new PermissionManager();
    const tool = makeTool();

    // Mock check to return ask with tool-level rule (no ruleContent)
    const toolRule: PermissionRule = {
      source: "userSettings",
      behavior: "ask",
      value: { toolName: "Bash" },
    };

    vi.spyOn(pm, "check").mockResolvedValue({
      behavior: "ask",
      message: "Requires permission",
      reason: { type: "rule", rule: toolRule },
    });

    const onAsk = vi.fn(async () => ({ allowed: true, alwaysAllow: true }));
    await executeToolWithPermissions(
      makeRegistry(tool), "Bash", { command: "ls" }, makeContext(), pm, onAsk,
    );

    // Session rule should be broad (no ruleContent)
    const rules = pm.getContext().allowRules;
    expect(rules).toHaveLength(1);
    expect(rules[0].value.toolName).toBe("Bash");
    expect(rules[0].value.ruleContent).toBeUndefined();
  });
});
