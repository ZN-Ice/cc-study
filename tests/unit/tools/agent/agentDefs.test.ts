/**
 * Tests for built-in agent definitions.
 */

import { describe, test, expect } from "vitest";
import {
  createDefaultAgentDefinitions,
  builtInAgentDefinitions,
} from "../../../../src/tools/AgentTool/agentDefs.js";

describe("createDefaultAgentDefinitions", () => {
  test("returns registry with 3 built-in agents", () => {
    const registry = createDefaultAgentDefinitions();
    expect(registry.size).toBe(3);
    expect(registry.get("general-purpose")).toBeDefined();
    expect(registry.get("Explore")).toBeDefined();
    expect(registry.get("Plan")).toBeDefined();
  });

  test("general-purpose has correct properties", () => {
    const registry = createDefaultAgentDefinitions();
    const gp = registry.get("general-purpose")!;
    expect(gp.agentType).toBe("general-purpose");
    expect(gp.isReadOnly).toBe(false);
    expect(gp.disallowedTools).toBeUndefined();
    expect(gp.maxTurns).toBe(20);
  });

  test("Explore agent is read-only and disallows write tools", () => {
    const registry = createDefaultAgentDefinitions();
    const explore = registry.get("Explore")!;
    expect(explore.agentType).toBe("Explore");
    expect(explore.isReadOnly).toBe(true);
    expect(explore.disallowedTools).toEqual(["Write", "Edit", "Agent"]);
  });

  test("Plan agent is read-only and disallows write tools", () => {
    const registry = createDefaultAgentDefinitions();
    const plan = registry.get("Plan")!;
    expect(plan.agentType).toBe("Plan");
    expect(plan.isReadOnly).toBe(true);
    expect(plan.disallowedTools).toEqual(["Write", "Edit", "Agent"]);
  });

  test("all agents have non-empty whenToUse", () => {
    const registry = createDefaultAgentDefinitions();
    for (const def of registry.getAll()) {
      expect(def.whenToUse.length).toBeGreaterThan(0);
    }
  });

  test("all agents have non-empty system prompts", () => {
    const registry = createDefaultAgentDefinitions();
    for (const def of registry.getAll()) {
      expect(def.getSystemPrompt().length).toBeGreaterThan(0);
    }
  });

  test("Explore system prompt mentions READ-ONLY", () => {
    const registry = createDefaultAgentDefinitions();
    const explore = registry.get("Explore")!;
    expect(explore.getSystemPrompt()).toContain("READ-ONLY");
  });

  test("Plan system prompt mentions architect or plan", () => {
    const registry = createDefaultAgentDefinitions();
    const plan = registry.get("Plan")!;
    const prompt = plan.getSystemPrompt().toLowerCase();
    expect(prompt.includes("architect") || prompt.includes("plan")).toBe(true);
  });
});

describe("builtInAgentDefinitions", () => {
  test("is an array of 3 definitions", () => {
    expect(builtInAgentDefinitions).toHaveLength(3);
    expect(builtInAgentDefinitions.map((d) => d.agentType)).toEqual([
      "general-purpose",
      "Explore",
      "Plan",
    ]);
  });
});
