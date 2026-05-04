/**
 * Tests for TeamCreateTool and SendMessageTool registration in the default tool registry.
 * Bug: TeamCreateTool and SendMessageTool were not registered, so the LLM couldn't
 * create teams or coordinate multi-agent workflows via team_create/send_message.
 *
 * User symptom: "创建一个研究团队" (create a research team) only triggered
 * Explore agent instead of creating a team via team_create tool.
 *
 * Root cause: createDefaultRegistry() in src/tools/index.ts did not import or
 * register TeamCreateTool or SendMessageTool.
 */

import { describe, it, expect } from "vitest";
import { createDefaultRegistry } from "../../../src/tools/index.js";
import { TeamCreateTool } from "../../../src/tools/TeamCreateTool/index.js";
import { SendMessageTool } from "../../../src/tools/SendMessageTool/index.js";

describe("TeamCreateTool registration", () => {
  it("registers team_create in the default registry", () => {
    const registry = createDefaultRegistry();
    const toolDefs = registry.getToolDefinitions();
    const toolNames = toolDefs.map((t) => t.name);

    expect(toolNames).toContain("team_create");
  });

  it("team_create tool can be retrieved by name", () => {
    const registry = createDefaultRegistry();
    const tool = registry.get("team_create");

    expect(tool).toBeDefined();
    expect(tool!.name).toBe("team_create");
  });

  it("team_create has correct input schema properties", () => {
    const registry = createDefaultRegistry();
    const toolDefs = registry.getToolDefinitions();
    const teamTool = toolDefs.find((t) => t.name === "team_create");

    expect(teamTool).toBeDefined();
    const props = teamTool!.input_schema.properties ?? {};
    expect(props).toHaveProperty("team_name");
    expect(props).toHaveProperty("description");
    expect(props).toHaveProperty("agent_type");
  });
});

describe("SendMessageTool registration", () => {
  it("registers send_message in the default registry", () => {
    const registry = createDefaultRegistry();
    const toolDefs = registry.getToolDefinitions();
    const toolNames = toolDefs.map((t) => t.name);

    expect(toolNames).toContain("send_message");
  });

  it("send_message tool can be retrieved by name", () => {
    const registry = createDefaultRegistry();
    const tool = registry.get("send_message");

    expect(tool).toBeDefined();
    expect(tool!.name).toBe("send_message");
  });

  it("send_message has correct input schema properties", () => {
    const registry = createDefaultRegistry();
    const toolDefs = registry.getToolDefinitions();
    const msgTool = toolDefs.find((t) => t.name === "send_message");

    expect(msgTool).toBeDefined();
    const props = msgTool!.input_schema.properties ?? {};
    expect(props).toHaveProperty("to");
    expect(props).toHaveProperty("message");
    expect(props).toHaveProperty("summary");
  });
});

describe("Complete team workflow tools", () => {
  it("all core tools + team tools are registered together", () => {
    const registry = createDefaultRegistry();
    const toolDefs = registry.getToolDefinitions();
    const toolNames = toolDefs.map((t) => t.name);

    // Core tools
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("Write");
    expect(toolNames).toContain("Edit");
    expect(toolNames).toContain("Bash");
    expect(toolNames).toContain("Glob");
    expect(toolNames).toContain("Grep");
    // Agent tools
    expect(toolNames).toContain("Agent");
    // Team tools
    expect(toolNames).toContain("team_create");
    expect(toolNames).toContain("send_message");
    // Skill tools
    expect(toolNames).toContain("Skill");
  });

  it("TeamCreateTool and SendMessageTool are distinct from each other", () => {
    expect(TeamCreateTool.name).toBe("team_create");
    expect(SendMessageTool.name).toBe("send_message");
    expect(TeamCreateTool.name).not.toBe(SendMessageTool.name);
  });
});
