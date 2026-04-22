/**
 * PermissionManager tests.
 *
 * Tests for: check(), addRule(), loadFromConfig(), getContext().
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { PermissionConfig } from "../../../src/permissions/types.js";
import { PermissionManager } from "../../../src/permissions/manager.js";
import type { Tool, ToolContext } from "../../../src/tools/types.js";
import { z } from "zod";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

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
// Constructor & getContext
// ──────────────────────────────────────────────

describe("PermissionManager", () => {
  test("creates with default mode", () => {
    const pm = new PermissionManager();
    expect(pm.getContext().mode).toBe("default");
  });

  test("creates with specified mode", () => {
    const pm = new PermissionManager("bypassPermissions");
    expect(pm.getContext().mode).toBe("bypassPermissions");
  });

  test("initializes with empty rules", () => {
    const pm = new PermissionManager();
    const ctx = pm.getContext();
    expect(ctx.allowRules).toEqual([]);
    expect(ctx.denyRules).toEqual([]);
    expect(ctx.askRules).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// addRule
// ──────────────────────────────────────────────

describe("PermissionManager.addRule", () => {
  test("adds allow rule", () => {
    const pm = new PermissionManager();
    pm.addRule({
      source: "session",
      behavior: "allow",
      value: { toolName: "Read" },
    });
    expect(pm.getContext().allowRules).toHaveLength(1);
  });

  test("adds deny rule", () => {
    const pm = new PermissionManager();
    pm.addRule({
      source: "session",
      behavior: "deny",
      value: { toolName: "Bash", ruleContent: "rm -rf*" },
    });
    expect(pm.getContext().denyRules).toHaveLength(1);
  });

  test("adds ask rule", () => {
    const pm = new PermissionManager();
    pm.addRule({
      source: "session",
      behavior: "ask",
      value: { toolName: "Write" },
    });
    expect(pm.getContext().askRules).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────
// loadFromConfig
// ──────────────────────────────────────────────

describe("PermissionManager.loadFromConfig", () => {
  test("loads allow rules from config strings", () => {
    const pm = new PermissionManager();
    const config: PermissionConfig = {
      allow: ["Read", "Bash(git status*)", "Glob"],
    };
    pm.loadFromConfig(config, "userSettings");
    expect(pm.getContext().allowRules).toHaveLength(3);
    expect(pm.getContext().allowRules[0].value.toolName).toBe("Read");
    expect(pm.getContext().allowRules[1].value.ruleContent).toBe("git status*");
  });

  test("loads deny rules from config strings", () => {
    const pm = new PermissionManager();
    const config: PermissionConfig = {
      deny: ["Bash(rm -rf*)", "Bash(sudo*)"],
    };
    pm.loadFromConfig(config, "projectSettings");
    expect(pm.getContext().denyRules).toHaveLength(2);
    expect(pm.getContext().denyRules[0].source).toBe("projectSettings");
  });

  test("loads ask rules from config strings", () => {
    const pm = new PermissionManager();
    const config: PermissionConfig = {
      ask: ["Bash", "Write", "Edit"],
    };
    pm.loadFromConfig(config, "session");
    expect(pm.getContext().askRules).toHaveLength(3);
  });

  test("handles empty config", () => {
    const pm = new PermissionManager();
    pm.loadFromConfig({}, "userSettings");
    expect(pm.getContext().allowRules).toHaveLength(0);
  });

  test("sets mode from config", () => {
    const pm = new PermissionManager();
    pm.loadFromConfig({ mode: "bypassPermissions" }, "userSettings");
    expect(pm.getContext().mode).toBe("bypassPermissions");
  });
});

// ──────────────────────────────────────────────
// check — deny rules
// ──────────────────────────────────────────────

describe("PermissionManager.check — deny rules", () => {
  test("denies when tool matches deny rule", async () => {
    const pm = new PermissionManager();
    pm.addRule({
      source: "userSettings",
      behavior: "deny",
      value: { toolName: "Bash" },
    });

    const decision = await pm.check(makeTool(), { command: "ls" }, makeContext());
    expect(decision.behavior).toBe("deny");
  });

  test("deny rule takes priority over allow rule", async () => {
    const pm = new PermissionManager();
    pm.addRule({
      source: "userSettings",
      behavior: "allow",
      value: { toolName: "Bash" },
    });
    pm.addRule({
      source: "session",
      behavior: "deny",
      value: { toolName: "Bash" },
    });

    const decision = await pm.check(makeTool(), { command: "ls" }, makeContext());
    expect(decision.behavior).toBe("deny");
  });
});

// ──────────────────────────────────────────────
// check — ask rules
// ──────────────────────────────────────────────

describe("PermissionManager.check — ask rules", () => {
  test("asks when tool matches ask rule", async () => {
    const pm = new PermissionManager();
    pm.addRule({
      source: "session",
      behavior: "ask",
      value: { toolName: "Bash" },
    });

    const decision = await pm.check(makeTool(), { command: "ls" }, makeContext());
    expect(decision.behavior).toBe("ask");
  });
});

// ──────────────────────────────────────────────
// check — allow rules
// ──────────────────────────────────────────────

describe("PermissionManager.check — allow rules", () => {
  test("allows when tool matches allow rule", async () => {
    const pm = new PermissionManager();
    pm.addRule({
      source: "userSettings",
      behavior: "allow",
      value: { toolName: "Read" },
    });

    const tool = makeTool({ name: "Read" });
    const decision = await pm.check(tool, { file_path: "/test/a.txt" }, makeContext());
    expect(decision.behavior).toBe("allow");
  });

  test("allows when content matches allow rule", async () => {
    const pm = new PermissionManager();
    pm.addRule({
      source: "session",
      behavior: "allow",
      value: { toolName: "Bash", ruleContent: "git status*" },
    });

    const decision = await pm.check(
      makeTool(),
      { command: "git status" },
      makeContext(),
    );
    expect(decision.behavior).toBe("allow");
  });
});

// ──────────────────────────────────────────────
// check — bypassPermissions mode
// ──────────────────────────────────────────────

describe("PermissionManager.check — bypassPermissions mode", () => {
  test("allows all tools in bypassPermissions mode", async () => {
    const pm = new PermissionManager("bypassPermissions");
    const decision = await pm.check(makeTool(), { command: "rm -rf /" }, makeContext());
    expect(decision.behavior).toBe("allow");
  });

  test("still respects deny rules in bypassPermissions mode", async () => {
    const pm = new PermissionManager("bypassPermissions");
    pm.addRule({
      source: "userSettings",
      behavior: "deny",
      value: { toolName: "Bash", ruleContent: "rm -rf*" },
    });
    const decision = await pm.check(
      makeTool(),
      { command: "rm -rf /" },
      makeContext(),
    );
    expect(decision.behavior).toBe("deny");
  });
});

// ──────────────────────────────────────────────
// check — plan mode
// ──────────────────────────────────────────────

describe("PermissionManager.check — plan mode", () => {
  test("allows read-only tools in plan mode", async () => {
    const pm = new PermissionManager("plan");
    const tool = makeTool({
      name: "Read",
      isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
    });
    const decision = await pm.check(tool, { file_path: "/test/a.txt" }, makeContext());
    expect(decision.behavior).toBe("allow");
  });

  test("allows search tools in plan mode", async () => {
    const pm = new PermissionManager("plan");
    const tool = makeTool({
      name: "Grep",
      isSearchOrReadCommand: () => ({ isSearch: true, isRead: false }),
    });
    const decision = await pm.check(tool, { pattern: "test" }, makeContext());
    expect(decision.behavior).toBe("allow");
  });

  test("asks for write tools in plan mode", async () => {
    const pm = new PermissionManager("plan");
    const tool = makeTool({
      name: "Write",
      isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
    });
    const decision = await pm.check(tool, { file_path: "/test/a.txt" }, makeContext());
    expect(decision.behavior).toBe("ask");
  });
});

// ──────────────────────────────────────────────
// check — tool.checkPermissions
// ──────────────────────────────────────────────

describe("PermissionManager.check — tool.checkPermissions", () => {
  test("respects tool-level deny from checkPermissions", async () => {
    const pm = new PermissionManager();
    const tool = makeTool({
      name: "Bash",
      checkPermissions: vi.fn(async () => ({
        behavior: "deny" as const,
        message: "Dangerous command blocked",
        reason: { type: "safetyCheck" as const, reason: "destructive" },
      })),
    });
    const decision = await pm.check(tool, { command: "rm -rf /" }, makeContext());
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toBe("Dangerous command blocked");
  });

  test("allows when tool checkPermissions returns allow", async () => {
    const pm = new PermissionManager();
    const tool = makeTool({
      name: "Bash",
      checkPermissions: vi.fn(async () => ({
        behavior: "allow" as const,
      })),
    });
    const decision = await pm.check(tool, { command: "ls" }, makeContext());
    expect(decision.behavior).toBe("allow");
  });
});

// ──────────────────────────────────────────────
// check — default behavior
// ──────────────────────────────────────────────

describe("PermissionManager.check — default behavior", () => {
  test("returns ask when no rules match and mode is default", async () => {
    const pm = new PermissionManager();
    const decision = await pm.check(makeTool(), { command: "ls" }, makeContext());
    expect(decision.behavior).toBe("ask");
  });
});

// ──────────────────────────────────────────────
// parseRuleString helper
// ──────────────────────────────────────────────

describe("parseRuleString", () => {
  test("parses tool-only rule", async () => {
    const { parseRuleString } = await import("../../../src/permissions/manager.js");
    expect(parseRuleString("Bash")).toEqual({
      toolName: "Bash",
      ruleContent: undefined,
    });
  });

  test("parses tool with content rule", async () => {
    const { parseRuleString } = await import("../../../src/permissions/manager.js");
    expect(parseRuleString("Bash(npm test*)")).toEqual({
      toolName: "Bash",
      ruleContent: "npm test*",
    });
  });

  test("parses tool with file glob", async () => {
    const { parseRuleString } = await import("../../../src/permissions/manager.js");
    expect(parseRuleString("Read(*.md)")).toEqual({
      toolName: "Read",
      ruleContent: "*.md",
    });
  });

  test("handles tool name without parentheses", async () => {
    const { parseRuleString } = await import("../../../src/permissions/manager.js");
    expect(parseRuleString("Glob")).toEqual({
      toolName: "Glob",
      ruleContent: undefined,
    });
  });

  test("parses MCP tool name with double underscores", async () => {
    const { parseRuleString } = await import("../../../src/permissions/manager.js");
    expect(parseRuleString("mcp__server1__tool1")).toEqual({
      toolName: "mcp__server1__tool1",
      ruleContent: undefined,
    });
  });

  test("parses MCP tool name with content pattern", async () => {
    const { parseRuleString } = await import("../../../src/permissions/manager.js");
    expect(parseRuleString("mcp__server1__tool1(some-pattern)")).toEqual({
      toolName: "mcp__server1__tool1",
      ruleContent: "some-pattern",
    });
  });
});

// ──────────────────────────────────────────────
// loadFromSettingsFile
// ──────────────────────────────────────────────

describe("PermissionManager.loadFromSettingsFile", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `cc-study-pm-file-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("loads rules from settings.json file", async () => {
    const configPath = join(testDir, "settings.json");
    await writeFile(
      configPath,
      JSON.stringify({
        permissions: {
          allow: ["Bash(npm test*)"],
          deny: ["Bash(rm*)"],
        },
      }),
    );

    const pm = new PermissionManager();
    await pm.loadFromSettingsFile(configPath);

    expect(pm.getContext().allowRules).toHaveLength(1);
    expect(pm.getContext().allowRules[0].value.toolName).toBe("Bash");
    expect(pm.getContext().allowRules[0].value.ruleContent).toBe("npm test*");
    expect(pm.getContext().denyRules).toHaveLength(1);
    expect(pm.getContext().denyRules[0].source).toBe("projectSettings");
  });

  test("no-op when file does not exist", async () => {
    const pm = new PermissionManager();
    await pm.loadFromSettingsFile(join(testDir, "missing.json"));
    expect(pm.getContext().allowRules).toHaveLength(0);
  });

  test("no-op when file has no permissions key", async () => {
    const configPath = join(testDir, "settings.json");
    await writeFile(configPath, JSON.stringify({ other: true }));

    const pm = new PermissionManager();
    await pm.loadFromSettingsFile(configPath);
    expect(pm.getContext().allowRules).toHaveLength(0);
  });

  test("uses custom source when provided", async () => {
    const configPath = join(testDir, "settings.json");
    await writeFile(
      configPath,
      JSON.stringify({ permissions: { allow: ["Read"] } }),
    );

    const pm = new PermissionManager();
    await pm.loadFromSettingsFile(configPath, "userSettings");
    expect(pm.getContext().allowRules[0].source).toBe("userSettings");
  });

  test("loads mode from file", async () => {
    const configPath = join(testDir, "settings.json");
    await writeFile(
      configPath,
      JSON.stringify({ permissions: { mode: "bypassPermissions" } }),
    );

    const pm = new PermissionManager();
    await pm.loadFromSettingsFile(configPath);
    expect(pm.getContext().mode).toBe("bypassPermissions");
  });
});
