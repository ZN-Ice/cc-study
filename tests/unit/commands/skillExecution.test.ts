/**
 * Tests for skill execution through the command executor.
 * Verifies that loaded skills can be invoked via slash commands.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeCommand } from "../../../src/commands/executor.js";
import type { CommandContext } from "../../../src/commands/types.js";
import type { SkillCommand } from "../../../src/skills/types.js";
import { clearBundledSkills } from "../../../src/skills/bundledRegistry.js";

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
    source: "project",
    loadedFrom: "skills",
    async getPromptForCommand(args: string) {
      return [{ type: "text", text: `Test skill output: ${args}` }];
    },
    ...overrides,
  };
}

const defaultContext: CommandContext = {
  abortSignal: new AbortController().signal,
  workingDirectory: process.cwd(),
};

describe("Skill execution via command executor", () => {
  const testSkill = makeMockSkill({ name: "test-skill" });
  const reviewSkill = makeMockSkill({
    name: "review",
    description: "Review code changes",
    source: "bundled",
    loadedFrom: "bundled",
  });
  const hiddenSkill = makeMockSkill({
    name: "internal-skill",
    userInvocable: false,
    isHidden: true,
  });

  const allSkills = [testSkill, reviewSkill, hiddenSkill];

  beforeEach(() => {
    clearBundledSkills();
  });

  afterEach(() => {
    clearBundledSkills();
  });

  // ──────────────────────────────────────────────
  // Finding skills
  // ──────────────────────────────────────────────

  it("finds and executes a skill by name", async () => {
    const result = await executeCommand("/test-skill", defaultContext, allSkills);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Test skill output");
    expect(result!.isSkill).toBe(true);
  });

  it("finds skill with args", async () => {
    const result = await executeCommand(
      "/review focus on security",
      defaultContext,
      allSkills,
    );
    expect(result).not.toBeNull();
    expect(result!.text).toContain("focus on security");
    expect(result!.isSkill).toBe(true);
  });

  it("returns not found for unknown skill", async () => {
    const result = await executeCommand(
      "/nonexistent",
      defaultContext,
      allSkills,
    );
    expect(result!.text).toContain("not found");
    expect(result!.isSkill).toBe(false);
  });

  it("still finds builtin commands alongside skills", async () => {
    const result = await executeCommand("/help", defaultContext, allSkills);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Available Commands");
    expect(result!.isSkill).toBe(false);
  });

  it("skill takes precedence over builtin with same name is not an issue since names differ", async () => {
    // Builtin /help still works even with skills present
    const result = await executeCommand("/help", defaultContext, allSkills);
    expect(result!.text).toContain("Available Commands");
  });

  // ──────────────────────────────────────────────
  // User invocable guard
  // ──────────────────────────────────────────────

  it("finds hidden skills (user_invocable=false) since the model can invoke them", async () => {
    const result = await executeCommand(
      "/internal-skill",
      defaultContext,
      allSkills,
    );
    // Hidden skills should still be executable via the command system
    // (The model or SkillTool can still use them)
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Test skill output");
    expect(result!.isSkill).toBe(true);
  });

  // ──────────────────────────────────────────────
  // Edge cases
  // ──────────────────────────────────────────────

  it("handles empty skills array", async () => {
    const result = await executeCommand("/test-skill", defaultContext, []);
    expect(result!.text).toContain("not found");
  });

  it("handles undefined skills (backward compat)", async () => {
    const result = await executeCommand("/test-skill", defaultContext);
    expect(result!.text).toContain("not found");
  });

  it("non-slash input returns null", async () => {
    const result = await executeCommand("hello", defaultContext, allSkills);
    expect(result).toBeNull();
  });
});
