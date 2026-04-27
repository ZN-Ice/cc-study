/**
 * Tests for SkillTool.
 */

import { describe, test, expect, beforeEach } from "vitest";
import {
  SkillTool,
  setSkillLookup,
} from "../../../src/tools/SkillTool/index.js";
import type { SkillCommand } from "../../../src/skills/types.js";
import { clearUsageData } from "../../../src/skills/usageTracking.js";
import type { PermissionRule } from "../../../src/permissions/types.js";

function makeMockSkill(overrides: Partial<SkillCommand> = {}): SkillCommand {
  return {
    type: "prompt",
    name: "test-skill",
    description: "A test skill",
    disableModelInvocation: false,
    userInvocable: true,
    isHidden: false,
    progressMessage: "running",
    contentLength: 100,
    source: "bundled",
    loadedFrom: "bundled",
    async getPromptForCommand(args: string) {
      return [{ type: "text", text: `Skill prompt: ${args}` }];
    },
    ...overrides,
  };
}

function makeDenyRule(content: string): PermissionRule {
  return {
    source: "session",
    behavior: "deny",
    value: { toolName: "Skill", ruleContent: content },
  };
}

function makeAllowRule(content: string): PermissionRule {
  return {
    source: "session",
    behavior: "allow",
    value: { toolName: "Skill", ruleContent: content },
  };
}

describe("SkillTool", () => {
  beforeEach(() => {
    clearUsageData();
    setSkillLookup(() => undefined);
  });

  // ──────────────────────────────────────────────
  // validateInput
  // ──────────────────────────────────────────────

  test("rejects empty skill name", async () => {
    const result = await SkillTool.validateInput({ skill: "" }, {
      workingDirectory: "/tmp",
      abortSignal: new AbortController().signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("empty");
    }
  });

  test("rejects unknown skill", async () => {
    setSkillLookup(() => undefined);
    const result = await SkillTool.validateInput({ skill: "nonexistent" }, {
      workingDirectory: "/tmp",
      abortSignal: new AbortController().signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unknown skill");
    }
  });

  test("accepts valid skill", async () => {
    setSkillLookup((name) =>
      name === "review" ? makeMockSkill({ name: "review" }) : undefined,
    );
    const result = await SkillTool.validateInput({ skill: "review" }, {
      workingDirectory: "/tmp",
      abortSignal: new AbortController().signal,
    });
    expect(result.ok).toBe(true);
  });

  test("strips leading slash before lookup", async () => {
    setSkillLookup((name) =>
      name === "review" ? makeMockSkill({ name: "review" }) : undefined,
    );
    const result = await SkillTool.validateInput({ skill: "/review" }, {
      workingDirectory: "/tmp",
      abortSignal: new AbortController().signal,
    });
    expect(result.ok).toBe(true);
  });

  test("rejects skill with disableModelInvocation", async () => {
    setSkillLookup(() => makeMockSkill({ disableModelInvocation: true }));
    const result = await SkillTool.validateInput({ skill: "internal" }, {
      workingDirectory: "/tmp",
      abortSignal: new AbortController().signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("disable-model-invocation");
    }
  });

  // ──────────────────────────────────────────────
  // checkPermissions
  // ──────────────────────────────────────────────

  test("denies when matching deny rule", async () => {
    setSkillLookup(() => makeMockSkill());
    const result = await SkillTool.checkPermissions!(
      { skill: "test-skill" },
      {
        workingDirectory: "/tmp",
        abortSignal: new AbortController().signal,
      },
      {
        mode: "default",
        denyRules: [makeDenyRule("test-skill")],
        allowRules: [],
      },
    );
    expect(result?.behavior).toBe("deny");
  });

  test("allows when matching allow rule", async () => {
    setSkillLookup(() => makeMockSkill());
    const result = await SkillTool.checkPermissions!(
      { skill: "test-skill" },
      {
        workingDirectory: "/tmp",
        abortSignal: new AbortController().signal,
      },
      {
        mode: "default",
        denyRules: [],
        allowRules: [makeAllowRule("test-skill")],
      },
    );
    expect(result?.behavior).toBe("allow");
  });

  test("auto-allows safe skills", async () => {
    setSkillLookup(() => makeMockSkill());
    const result = await SkillTool.checkPermissions!(
      { skill: "test-skill" },
      {
        workingDirectory: "/tmp",
        abortSignal: new AbortController().signal,
      },
      { mode: "default", denyRules: [], allowRules: [] },
    );
    expect(result?.behavior).toBe("allow");
  });

  test("asks when skill has unsafe properties", async () => {
    const unsafeSkill = makeMockSkill({
      hooks: { preToolUse: [] as never[] },
    });
    setSkillLookup(() => unsafeSkill);
    const result = await SkillTool.checkPermissions!(
      { skill: "test-skill" },
      {
        workingDirectory: "/tmp",
        abortSignal: new AbortController().signal,
      },
      { mode: "default", denyRules: [], allowRules: [] },
    );
    expect(result?.behavior).toBe("ask");
  });

  test("prefix wildcard matches", async () => {
    setSkillLookup(() => makeMockSkill({ name: "test-extended" }));
    const result = await SkillTool.checkPermissions!(
      { skill: "test-extended" },
      {
        workingDirectory: "/tmp",
        abortSignal: new AbortController().signal,
      },
      {
        mode: "default",
        denyRules: [makeDenyRule("test:*")],
        allowRules: [],
      },
    );
    expect(result?.behavior).toBe("deny");
  });

  // ──────────────────────────────────────────────
  // execute
  // ──────────────────────────────────────────────

  test("executes inline skill and returns content", async () => {
    setSkillLookup(() => makeMockSkill({ name: "review" }));
    const result = await SkillTool.execute(
      { skill: "review", args: "focus on security" },
      {
        workingDirectory: "/tmp",
        abortSignal: new AbortController().signal,
      },
    );
    expect(result.error).toBeFalsy();
    expect(result.output).toContain("Skill prompt: focus on security");
    expect(result.metadata?.skillName).toBe("review");
  });

  test("returns error for unknown skill during execute", async () => {
    setSkillLookup(() => undefined);
    const result = await SkillTool.execute(
      { skill: "nonexistent" },
      {
        workingDirectory: "/tmp",
        abortSignal: new AbortController().signal,
      },
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("Unknown skill");
  });

  test("records usage on execute", async () => {
    setSkillLookup(() => makeMockSkill({ name: "review" }));
    await SkillTool.execute(
      { skill: "review" },
      {
        workingDirectory: "/tmp",
        abortSignal: new AbortController().signal,
      },
    );
    const { getSkillUsageScore } = await import("../../../src/skills/usageTracking.js");
    expect(getSkillUsageScore("review")).toBeGreaterThan(0);
  });
});
