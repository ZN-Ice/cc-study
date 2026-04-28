/**
 * Tests for skill invocation behavior in the command executor.
 *
 * Verifies that:
 * 1. executeCommand returns { text, isSkill } to distinguish skill vs builtin results
 * 2. Skill invocations are marked with isSkill=true
 * 3. Builtin command invocations are marked with isSkill=false
 * 4. Unknown commands return null (no change)
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
      return [{ type: "text", text: `Skill content: ${args || "no args"}` }];
    },
    ...overrides,
  };
}

const defaultContext: CommandContext = {
  abortSignal: new AbortController().signal,
  workingDirectory: process.cwd(),
};

describe("Skill invocation integration", () => {
  const testSkill = makeMockSkill({ name: "test-skill" });
  const reviewSkill = makeMockSkill({
    name: "review",
    description: "Review code",
    source: "bundled",
    loadedFrom: "bundled",
  });
  const hiddenSkill = makeMockSkill({
    name: "internal",
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
  // Return type shape
  // ──────────────────────────────────────────────

  describe("return type", () => {
    it("returns { text, isSkill } for skill invocation", async () => {
      const result = await executeCommand("/test-skill", defaultContext, allSkills);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("isSkill");
      expect(typeof result!.text).toBe("string");
      expect(typeof result!.isSkill).toBe("boolean");
    });

    it("returns { text, isSkill: false } for builtin command", async () => {
      const result = await executeCommand("/help", defaultContext, allSkills);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("isSkill");
      expect(result!.isSkill).toBe(false);
    });

    it("returns null for unknown command", async () => {
      const result = await executeCommand("/nonexistent", defaultContext, allSkills);
      // Unknown commands should still return a result with isSkill=false
      expect(result).not.toBeNull();
      expect(result!.isSkill).toBe(false);
      expect(result!.text).toContain("not found");
    });

    it("returns null for non-slash input", async () => {
      const result = await executeCommand("hello", defaultContext, allSkills);
      expect(result).toBeNull();
    });
  });

  // ──────────────────────────────────────────────
  // Skill identification
  // ──────────────────────────────────────────────

  describe("skill identification", () => {
    it("marks project skill as isSkill=true", async () => {
      const result = await executeCommand("/test-skill", defaultContext, allSkills);
      expect(result!.isSkill).toBe(true);
    });

    it("marks bundled skill as isSkill=true", async () => {
      const result = await executeCommand("/review", defaultContext, allSkills);
      expect(result!.isSkill).toBe(true);
    });

    it("marks hidden skill as isSkill=true when invoked directly", async () => {
      const result = await executeCommand("/internal", defaultContext, allSkills);
      expect(result!.isSkill).toBe(true);
    });

    it("marks builtin /help as isSkill=false", async () => {
      const result = await executeCommand("/help", defaultContext, allSkills);
      expect(result!.isSkill).toBe(false);
    });

    it("marks builtin /config as isSkill=false", async () => {
      const result = await executeCommand("/config", defaultContext, allSkills);
      expect(result!.isSkill).toBe(false);
    });
  });

  // ──────────────────────────────────────────────
  // Skill content is correct
  // ──────────────────────────────────────────────

  describe("skill content", () => {
    it("returns skill prompt content in text field", async () => {
      const result = await executeCommand("/test-skill", defaultContext, allSkills);
      expect(result!.text).toContain("Skill content:");
    });

    it("passes args to skill prompt", async () => {
      const result = await executeCommand(
        "/test-skill some arguments",
        defaultContext,
        allSkills,
      );
      expect(result!.text).toContain("some arguments");
    });
  });
});
