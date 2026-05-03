/**
 * Tests for Agent type definitions and AgentDefinitionRegistry.
 */

import { describe, test, expect } from "vitest";
import {
  AgentDefinitionRegistry,
  agentToolInputSchema,
  type AgentDefinition,
} from "../../../../src/tools/AgentTool/types.js";

describe("AgentDefinitionRegistry", () => {
  test("register and get an agent definition", () => {
    const registry = new AgentDefinitionRegistry();
    const def: AgentDefinition = {
      agentType: "test-agent",
      whenToUse: "A test agent",
      getSystemPrompt: () => "You are a test agent.",
    };
    registry.register(def);
    expect(registry.get("test-agent")).toBe(def);
  });

  test("get returns undefined for unknown agent type", () => {
    const registry = new AgentDefinitionRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  test("getAll returns all registered definitions", () => {
    const registry = new AgentDefinitionRegistry();
    registry.register({
      agentType: "agent-a",
      whenToUse: "Agent A",
      getSystemPrompt: () => "A",
    });
    registry.register({
      agentType: "agent-b",
      whenToUse: "Agent B",
      getSystemPrompt: () => "B",
    });
    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((d) => d.agentType)).toContain("agent-a");
    expect(all.map((d) => d.agentType)).toContain("agent-b");
  });

  test("rejects duplicate agent type registration", () => {
    const registry = new AgentDefinitionRegistry();
    registry.register({
      agentType: "dup",
      whenToUse: "First",
      getSystemPrompt: () => "First",
    });
    expect(() =>
      registry.register({
        agentType: "dup",
        whenToUse: "Second",
        getSystemPrompt: () => "Second",
      }),
    ).toThrow(/already registered/);
  });

  test("size returns correct count", () => {
    const registry = new AgentDefinitionRegistry();
    expect(registry.size).toBe(0);
    registry.register({
      agentType: "a",
      whenToUse: "A",
      getSystemPrompt: () => "A",
    });
    expect(registry.size).toBe(1);
  });
});

describe("agentToolInputSchema", () => {
  test("accepts valid input with required fields", () => {
    const result = agentToolInputSchema.safeParse({
      description: "search code",
      prompt: "Find all TODO comments",
    });
    expect(result.success).toBe(true);
  });

  test("accepts valid input with all fields", () => {
    const result = agentToolInputSchema.safeParse({
      description: "explore files",
      prompt: "Find all TypeScript files",
      subagent_type: "Explore",
      model: "claude-sonnet-4-6",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subagent_type).toBe("Explore");
      expect(result.data.model).toBe("claude-sonnet-4-6");
    }
  });

  test("rejects input missing required description", () => {
    const result = agentToolInputSchema.safeParse({
      prompt: "Some task",
    });
    expect(result.success).toBe(false);
  });

  test("rejects input missing required prompt", () => {
    const result = agentToolInputSchema.safeParse({
      description: "task",
    });
    expect(result.success).toBe(false);
  });

  test("rejects unknown fields (strict mode)", () => {
    const result = agentToolInputSchema.safeParse({
      description: "task",
      prompt: "Do something",
      unknown_field: true,
    });
    expect(result.success).toBe(false);
  });

  test("accepts isolation field", () => {
    const result = agentToolInputSchema.safeParse({
      description: "refactor",
      prompt: "Refactor module X",
      isolation: "worktree",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isolation).toBe("worktree");
    }
  });

  test("rejects invalid isolation value", () => {
    const result = agentToolInputSchema.safeParse({
      description: "task",
      prompt: "Do something",
      isolation: "remote",
    });
    expect(result.success).toBe(false);
  });
});
