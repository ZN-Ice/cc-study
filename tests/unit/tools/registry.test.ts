/**
 * Tests for ToolRegistry
 */
import { describe, test, expect } from "vitest";
import { ToolRegistry } from "../../../src/tools/registry.js";
import type { Tool } from "../../../src/tools/types.js";

const mockTool: Tool = {
  name: "Mock",
  description: "A mock tool for testing",
  parameters: {
    type: "object",
    properties: { input: { type: "string" } },
    required: ["input"],
  },
  async execute(params) {
    return { output: `mock: ${params.input}` };
  },
};

const mockTool2: Tool = {
  name: "Mock2",
  description: "Another mock tool",
  parameters: { type: "object", properties: {} },
  async execute() {
    return { output: "mock2" };
  },
};

describe("ToolRegistry", () => {
  test("registers and retrieves tools", () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);
    expect(registry.get("Mock")).toBe(mockTool);
    expect(registry.get("Unknown")).toBeUndefined();
  });

  test("rejects duplicate registration", () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);
    expect(() => registry.register(mockTool)).toThrow("already registered");
  });

  test("getAll returns all tools", () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);
    registry.register(mockTool2);
    expect(registry.getAll()).toHaveLength(2);
    expect(registry.getNames()).toEqual(["Mock", "Mock2"]);
  });

  test("generates tool definitions for API", () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);
    const defs = registry.getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toEqual({
      name: "Mock",
      description: "A mock tool for testing",
      input_schema: {
        type: "object",
        properties: { input: { type: "string" } },
        required: ["input"],
      },
    });
  });

  test("has and size work correctly", () => {
    const registry = new ToolRegistry();
    expect(registry.size).toBe(0);
    expect(registry.has("Mock")).toBe(false);
    registry.register(mockTool);
    expect(registry.size).toBe(1);
    expect(registry.has("Mock")).toBe(true);
  });
});
