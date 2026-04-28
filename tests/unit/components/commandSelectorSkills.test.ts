/**
 * Tests for CommandSelector skill autocomplete integration.
 * Bug: CommandSelector only showed builtins, not skills.
 */

import { describe, it, expect } from "vitest";
import { resolveCommandFilter } from "../../../src/components/CommandSelector.js";
import type { SkillCommand } from "../../../src/skills/types.js";

function makeMockSkill(overrides: Partial<SkillCommand> = {}): SkillCommand {
  return {
    type: "prompt",
    name: "test-skill",
    description: "A test skill for autocomplete",
    disableModelInvocation: false,
    userInvocable: true,
    isHidden: false,
    progressMessage: "running",
    contentLength: 100,
    source: "project",
    loadedFrom: "skills",
    async getPromptForCommand() {
      return [{ type: "text", text: "test output" }];
    },
    ...overrides,
  };
}

describe("resolveCommandFilter with skills", () => {
  it("returns builtin commands with empty filter", () => {
    const result = resolveCommandFilter("");
    expect(result.commands.length).toBeGreaterThan(0);
    const names = result.commands.map((c) => c.name);
    expect(names).toContain("help");
  });

  it("filters builtins by name", () => {
    const result = resolveCommandFilter("help");
    expect(result.commands.length).toBe(1);
    expect(result.commands[0].name).toBe("help");
  });

  // After fix: resolveCommandFilter should accept skills and include them
  it("includes user-invocable skills in results when skills are provided", () => {
    const skill = makeMockSkill({ name: "review", description: "Review code" });
    // @ts-expect-error - testing forward-compatible signature
    const result = resolveCommandFilter("", [skill]);
    const names = result.commands.map((c) => c.name);
    expect(names).toContain("review");
  });

  it("filters skills by name", () => {
    const skill = makeMockSkill({ name: "test-skill", description: "Test skill" });
    // @ts-expect-error - testing forward-compatible signature
    const result = resolveCommandFilter("test", [skill]);
    const names = result.commands.map((c) => c.name);
    expect(names).toContain("test-skill");
  });

  it("excludes non-user-invocable skills from autocomplete", () => {
    const hiddenSkill = makeMockSkill({
      name: "internal",
      userInvocable: false,
      isHidden: true,
    });
    // @ts-expect-error - testing forward-compatible signature
    const result = resolveCommandFilter("", [hiddenSkill]);
    const names = result.commands.map((c) => c.name);
    expect(names).not.toContain("internal");
  });

  it("excludes hidden skills from autocomplete", () => {
    const hiddenSkill = makeMockSkill({
      name: "secret",
      isHidden: true,
    });
    // @ts-expect-error - testing forward-compatible signature
    const result = resolveCommandFilter("", [hiddenSkill]);
    const names = result.commands.map((c) => c.name);
    expect(names).not.toContain("secret");
  });

  it("shows both builtins and skills together", () => {
    const skill = makeMockSkill({ name: "my-skill", description: "My skill" });
    // @ts-expect-error - testing forward-compatible signature
    const result = resolveCommandFilter("", [skill]);
    const names = result.commands.map((c) => c.name);
    expect(names).toContain("help");
    expect(names).toContain("my-skill");
  });
});
