/**
 * Tests for SkillTool registration in the default tool registry.
 * Bug: SkillTool was never registered, so the LLM couldn't invoke skills.
 */

import { describe, it, expect } from "vitest";
import { createDefaultRegistry } from "../../../src/tools/index.js";

describe("SkillTool registration", () => {
  it("registers SkillTool in the default registry", () => {
    const registry = createDefaultRegistry();
    const toolDefs = registry.getToolDefinitions();
    const toolNames = toolDefs.map((t) => t.name);

    expect(toolNames).toContain("Skill");
  });

  it("SkillTool appears alongside other core tools", () => {
    const registry = createDefaultRegistry();
    const toolDefs = registry.getToolDefinitions();
    const toolNames = toolDefs.map((t) => t.name);

    // All core tools should be present
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("Write");
    expect(toolNames).toContain("Edit");
    expect(toolNames).toContain("Bash");
    expect(toolNames).toContain("Glob");
    expect(toolNames).toContain("Grep");
    expect(toolNames).toContain("Agent");
    expect(toolNames).toContain("Skill");
  });

  it("SkillTool has correct input schema", () => {
    const registry = createDefaultRegistry();
    const toolDefs = registry.getToolDefinitions();
    const skillTool = toolDefs.find((t) => t.name === "Skill");

    expect(skillTool).toBeDefined();
    expect(skillTool!.input_schema).toBeDefined();
    // Schema should have 'skill' and optional 'args' properties
    const props = skillTool!.input_schema.properties ?? {};
    expect(props).toHaveProperty("skill");
    expect(props).toHaveProperty("args");
  });
});
