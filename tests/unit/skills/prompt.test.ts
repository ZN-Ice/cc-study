/**
 * Tests for SkillTool prompt budget management.
 */

import { describe, test, expect } from "vitest";
import {
  formatSkillsWithinBudget,
  getCharBudget,
} from "../../../src/tools/SkillTool/prompt.js";
import type { SkillCommand } from "../../../src/skills/types.js";

function makeSkill(overrides: Partial<SkillCommand> = {}): SkillCommand {
  return {
    type: "prompt",
    name: "test",
    description: "A test skill",
    source: "bundled",
    loadedFrom: "bundled",
    disableModelInvocation: false,
    userInvocable: true,
    isHidden: false,
    progressMessage: "running",
    contentLength: 100,
    async getPromptForCommand() {
      return [{ type: "text", text: "test" }];
    },
    ...overrides,
  };
}

describe("SkillTool Prompt", () => {
  test("getCharBudget returns default without context window", () => {
    expect(getCharBudget()).toBe(8000);
  });

  test("getCharBudget calculates 1% of context window", () => {
    // 200k tokens × 4 chars/token × 1% = 8000
    expect(getCharBudget(200000)).toBe(8000);
    expect(getCharBudget(100000)).toBe(4000);
  });

  test("formatSkillsWithinBudget returns empty for no skills", () => {
    expect(formatSkillsWithinBudget([])).toBe("");
  });

  test("formats full descriptions when within budget", () => {
    const skills = [
      makeSkill({ name: "review", description: "Review code" }),
      makeSkill({ name: "simplify", description: "Simplify code" }),
    ];
    const result = formatSkillsWithinBudget(skills);
    expect(result).toContain("review:");
    expect(result).toContain("simplify:");
    expect(result).toContain("Review code");
  });

  test("always preserves bundled skill descriptions", () => {
    const longDesc = "A".repeat(300);
    const skills = [
      makeSkill({ name: "bundled", description: longDesc, source: "bundled" }),
      makeSkill({ name: "user-skill", description: "B".repeat(300), source: "user" }),
    ];

    // Tiny budget: bundled gets truncated by MAX_LISTING_DESC_CHARS but keeps entry
    // Non-bundled gets names-only
    const result = formatSkillsWithinBudget(skills, 100);
    expect(result).toContain("bundled:");
    expect(result).toContain("- user-skill");
    // Bundled should have a description (even if truncated at 250)
    expect(result).toContain("AAA…");
  });

  test("truncates non-bundled descriptions under tight budget", () => {
    const skills = Array.from({ length: 50 }, (_, i) =>
      makeSkill({
        name: `skill-${i}`,
        description: `Skill ${i} with a very long description that goes on and on`,
        source: "user",
      }),
    );

    const result = formatSkillsWithinBudget(skills, 500);
    expect(result.length).toBeLessThanOrEqual(600); // Some margin for newlines
  });

  test("falls back to names-only for very tight budgets", () => {
    const skills = [
      makeSkill({ name: "a", description: "A skill", source: "user" }),
      makeSkill({ name: "b", description: "B skill", source: "user" }),
      makeSkill({ name: "c", description: "C skill", source: "user" }),
    ];

    // Very tight budget
    const result = formatSkillsWithinBudget(skills, 30);
    expect(result).toContain("- a");
    expect(result).toContain("- b");
    // Descriptions should be gone
    expect(result).not.toContain("A skill");
  });

  test("includes whenToUse in description", () => {
    const skill = makeSkill({
      name: "review",
      description: "Review code",
      whenToUse: "Use when reviewing PRs",
    });
    const result = formatSkillsWithinBudget([skill]);
    expect(result).toContain("Use when reviewing PRs");
  });

  test("truncates long descriptions to MAX_LISTING_DESC_CHARS", () => {
    const longDesc = "A".repeat(400);
    const skill = makeSkill({ name: "test", description: longDesc });
    const result = formatSkillsWithinBudget([skill]);
    expect(result.length).toBeLessThan(longDesc.length + 20);
    expect(result).toContain("…");
  });
});
