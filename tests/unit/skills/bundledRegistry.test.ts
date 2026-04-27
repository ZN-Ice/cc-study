/**
 * Tests for bundled skills registry.
 */

import { describe, test, expect, beforeEach } from "vitest";
import {
  registerBundledSkill,
  getBundledSkills,
  clearBundledSkills,
} from "../../../src/skills/bundledRegistry.js";

describe("Bundled Skills Registry", () => {
  beforeEach(() => {
    clearBundledSkills();
  });

  test("registers and retrieves a skill", () => {
    registerBundledSkill({
      name: "test-skill",
      description: "Test",
      async getPromptForCommand(args) {
        return [{ type: "text", text: `prompt: ${args}` }];
      },
    });

    const skills = getBundledSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("test-skill");
    expect(skills[0]!.source).toBe("bundled");
    expect(skills[0]!.loadedFrom).toBe("bundled");
  });

  test("registers multiple skills", () => {
    registerBundledSkill({
      name: "skill-a",
      description: "A",
      async getPromptForCommand() {
        return [{ type: "text", text: "a" }];
      },
    });
    registerBundledSkill({
      name: "skill-b",
      description: "B",
      async getPromptForCommand() {
        return [{ type: "text", text: "b" }];
      },
    });

    expect(getBundledSkills()).toHaveLength(2);
  });

  test("defaults userInvocable to true", () => {
    registerBundledSkill({
      name: "visible",
      description: "Visible",
      async getPromptForCommand() {
        return [{ type: "text", text: "" }];
      },
    });

    const skill = getBundledSkills()[0]!;
    expect(skill.userInvocable).toBe(true);
    expect(skill.isHidden).toBe(false);
  });

  test("sets isHidden when userInvocable is false", () => {
    registerBundledSkill({
      name: "hidden",
      description: "Hidden",
      userInvocable: false,
      async getPromptForCommand() {
        return [{ type: "text", text: "" }];
      },
    });

    const skill = getBundledSkills()[0]!;
    expect(skill.isHidden).toBe(true);
  });

  test("defaults disableModelInvocation to false", () => {
    registerBundledSkill({
      name: "default",
      description: "Default",
      async getPromptForCommand() {
        return [{ type: "text", text: "" }];
      },
    });

    expect(getBundledSkills()[0]!.disableModelInvocation).toBe(false);
  });

  test("filters disabled skills via isEnabled", () => {
    registerBundledSkill({
      name: "enabled",
      description: "Always on",
      isEnabled: () => true,
      async getPromptForCommand() {
        return [{ type: "text", text: "" }];
      },
    });
    registerBundledSkill({
      name: "disabled",
      description: "Always off",
      isEnabled: () => false,
      async getPromptForCommand() {
        return [{ type: "text", text: "" }];
      },
    });

    const skills = getBundledSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("enabled");
  });

  test("getPromptForCommand returns prompt content", async () => {
    registerBundledSkill({
      name: "test",
      description: "Test",
      async getPromptForCommand(args) {
        return [{ type: "text", text: `Args: ${args}` }];
      },
    });

    const skill = getBundledSkills()[0]!;
    const blocks = await skill.getPromptForCommand("hello");
    expect(blocks).toEqual([{ type: "text", text: "Args: hello" }]);
  });

  test("clearBundledSkills empties the registry", () => {
    registerBundledSkill({
      name: "temp",
      description: "Temp",
      async getPromptForCommand() {
        return [{ type: "text", text: "" }];
      },
    });

    expect(getBundledSkills()).toHaveLength(1);
    clearBundledSkills();
    expect(getBundledSkills()).toHaveLength(0);
  });
});
