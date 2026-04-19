/**
 * Permission rule matching engine tests.
 *
 * Tests for: toolMatchesRule, contentMatchesRule, getDenyRuleForTool,
 * getAskRuleForTool, getAllowRuleForTool.
 */

import { describe, test, expect } from "vitest";
import type {
  PermissionRule,
  ToolPermissionContext,
} from "../../../src/permissions/types.js";
import {
  toolMatchesRule,
  contentMatchesRule,
  getDenyRuleForTool,
  getAskRuleForTool,
  getAllowRuleForTool,
} from "../../../src/permissions/rules.js";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeRule(
  toolName: string,
  ruleContent?: string,
  behavior: "allow" | "deny" | "ask" = "allow",
  source: PermissionRule["source"] = "session",
): PermissionRule {
  return {
    source,
    behavior,
    value: { toolName, ruleContent },
  };
}

function makeContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: "default",
    allowRules: [],
    denyRules: [],
    askRules: [],
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// toolMatchesRule
// ──────────────────────────────────────────────

describe("toolMatchesRule", () => {
  test("matches tool by exact name when no ruleContent", () => {
    const rule = makeRule("Bash");
    expect(toolMatchesRule("Bash", rule)).toBe(true);
  });

  test("does not match different tool name", () => {
    const rule = makeRule("Bash");
    expect(toolMatchesRule("Read", rule)).toBe(false);
  });

  test("does not match when rule has ruleContent", () => {
    const rule = makeRule("Bash", "npm install*");
    expect(toolMatchesRule("Bash", rule)).toBe(false);
  });

  test("matches tool name case-sensitively", () => {
    const rule = makeRule("Bash");
    expect(toolMatchesRule("bash", rule)).toBe(false);
  });
});

// ──────────────────────────────────────────────
// contentMatchesRule
// ──────────────────────────────────────────────

describe("contentMatchesRule", () => {
  test("matches glob pattern for command prefix", () => {
    const rule = makeRule("Bash", "npm install*");
    expect(contentMatchesRule("npm install xyz", rule)).toBe(true);
  });

  test("matches glob pattern for file extension", () => {
    const rule = makeRule("Read", "*.md");
    expect(contentMatchesRule("README.md", rule)).toBe(true);
  });

  test("does not match non-matching content", () => {
    const rule = makeRule("Bash", "npm install*");
    expect(contentMatchesRule("npm publish", rule)).toBe(false);
  });

  test("returns false when rule has no ruleContent", () => {
    const rule = makeRule("Bash");
    expect(contentMatchesRule("anything", rule)).toBe(false);
  });

  test("matches exact content without glob", () => {
    const rule = makeRule("Bash", "git status");
    expect(contentMatchesRule("git status", rule)).toBe(true);
  });

  test("matches wildcard * for any content", () => {
    const rule = makeRule("Bash", "*");
    expect(contentMatchesRule("anything here", rule)).toBe(true);
  });

  test("matches glob with path", () => {
    const rule = makeRule("Write", "/etc/*");
    expect(contentMatchesRule("/etc/hosts", rule)).toBe(true);
  });
});

// ──────────────────────────────────────────────
// getDenyRuleForTool
// ──────────────────────────────────────────────

describe("getDenyRuleForTool", () => {
  test("returns deny rule matching tool name", () => {
    const rule = makeRule("Bash", undefined, "deny");
    const ctx = makeContext({ denyRules: [rule] });
    expect(getDenyRuleForTool(ctx, "Bash")).toBe(rule);
  });

  test("returns null when no deny rules match", () => {
    const rule = makeRule("Bash", undefined, "deny");
    const ctx = makeContext({ denyRules: [rule] });
    expect(getDenyRuleForTool(ctx, "Read")).toBeNull();
  });

  test("returns null when deny rules list is empty", () => {
    const ctx = makeContext();
    expect(getDenyRuleForTool(ctx, "Bash")).toBeNull();
  });

  test("returns first matching deny rule", () => {
    const rule1 = makeRule("Read", undefined, "deny", "userSettings");
    const rule2 = makeRule("Read", undefined, "deny", "projectSettings");
    const ctx = makeContext({ denyRules: [rule1, rule2] });
    expect(getDenyRuleForTool(ctx, "Read")).toBe(rule1);
  });
});

// ──────────────────────────────────────────────
// getAskRuleForTool
// ──────────────────────────────────────────────

describe("getAskRuleForTool", () => {
  test("returns ask rule matching tool name", () => {
    const rule = makeRule("Bash", undefined, "ask");
    const ctx = makeContext({ askRules: [rule] });
    expect(getAskRuleForTool(ctx, "Bash")).toBe(rule);
  });

  test("returns null when no ask rules match", () => {
    const rule = makeRule("Bash", undefined, "ask");
    const ctx = makeContext({ askRules: [rule] });
    expect(getAskRuleForTool(ctx, "Read")).toBeNull();
  });
});

// ──────────────────────────────────────────────
// getAllowRuleForTool
// ──────────────────────────────────────────────

describe("getAllowRuleForTool", () => {
  test("returns allow rule matching tool name", () => {
    const rule = makeRule("Bash", undefined, "allow");
    const ctx = makeContext({ allowRules: [rule] });
    expect(getAllowRuleForTool(ctx, "Bash")).toBe(rule);
  });

  test("returns null when no allow rules match", () => {
    const rule = makeRule("Bash", undefined, "allow");
    const ctx = makeContext({ allowRules: [rule] });
    expect(getAllowRuleForTool(ctx, "Read")).toBeNull();
  });

  test("matches allow rule with content", () => {
    const rule = makeRule("Bash", "npm test*", "allow");
    const ctx = makeContext({ allowRules: [rule] });
    // getAllowRuleForTool should also check content for tool+content rules
    expect(getAllowRuleForTool(ctx, "Bash", "npm test --run")).toBe(rule);
  });

  test("does not match allow rule content with wrong content", () => {
    const rule = makeRule("Bash", "npm test*", "allow");
    const ctx = makeContext({ allowRules: [rule] });
    expect(getAllowRuleForTool(ctx, "Bash", "npm publish")).toBeNull();
  });
});
