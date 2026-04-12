/**
 * Tests for ToolRegistry
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry, executeTool } from "../../../src/tools/registry.js";
import type { Tool, ToolContext, ValidationResult } from "../../../src/tools/types.js";

const mockSchema = z.strictObject({ input: z.string() });

const mockTool: Tool<typeof mockSchema> = {
  name: "Mock",
  description: "A mock tool for testing",
  inputSchema: mockSchema,
  async validateInput() {
    return { ok: true } as ValidationResult;
  },
  async execute(params) {
    return { output: `mock: ${params.input}` };
  },
};

const mockTool2Schema = z.strictObject({});
const mockTool2: Tool<typeof mockTool2Schema> = {
  name: "Mock2",
  description: "Another mock tool",
  inputSchema: mockTool2Schema,
  async validateInput() {
    return { ok: true } as ValidationResult;
  },
  async execute() {
    return { output: "mock2" };
  },
};

const mockContext: ToolContext = {
  workingDirectory: process.cwd(),
  abortSignal: new AbortController().signal,
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
    expect(defs[0].name).toBe("Mock");
    expect(defs[0].description).toBe("A mock tool for testing");
    expect(defs[0].input_schema.type).toBe("object");
    expect(defs[0].input_schema.properties).toHaveProperty("input");
    expect(defs[0].input_schema.required).toContain("input");
  });

  test("has and size work correctly", () => {
    const registry = new ToolRegistry();
    expect(registry.size).toBe(0);
    expect(registry.has("Mock")).toBe(false);
    registry.register(mockTool);
    expect(registry.size).toBe(1);
    expect(registry.has("Mock")).toBe(true);
  });

  test("executeTool returns error for unknown tool", async () => {
    const registry = new ToolRegistry();
    const result = await executeTool(registry, "Unknown", {}, mockContext);
    expect(result.error).toBe(true);
    expect(result.output).toContain("Unknown tool");
  });

  test("executeTool validates with Zod and rejects invalid input", async () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);
    const result = await executeTool(registry, "Mock", {}, mockContext);
    expect(result.error).toBe(true);
    expect(result.output).toContain("Invalid parameters");
  });

  test("executeTool runs validateInput before execute", async () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);
    const result = await executeTool(registry, "Mock", { input: "hello" }, mockContext);
    expect(result.error).toBeUndefined();
    expect(result.output).toBe("mock: hello");
  });
});
