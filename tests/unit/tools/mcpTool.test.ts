/**
 * Tests for MCPTool adapter
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { createMcpTool, normalizeMcpName } from "../../../src/tools/MCPTool.js";
import type { McpToolInfo, McpClientManager } from "../../../src/services/mcpClient.js";
import type { ToolContext } from "../../../src/tools/types.js";

// Mock mcpClientManager
function createMockManager(overrides?: {
  callTool?: (server: string, tool: string, args: Record<string, unknown>) => Promise<string>;
}): McpClientManager {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    disconnectAll: vi.fn(),
    fetchTools: vi.fn(),
    fetchAllTools: vi.fn(),
    callTool: overrides?.callTool ?? vi.fn().mockResolvedValue("mock result"),
  } as unknown as McpClientManager;
}

const mockToolInfo: McpToolInfo = {
  name: "search",
  description: "Search the web for information",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};

const mockContext: ToolContext = {
  workingDirectory: process.cwd(),
  abortSignal: new AbortController().signal,
};

describe("normalizeMcpName", () => {
  test("replaces special characters with underscores", () => {
    expect(normalizeMcpName("my-server")).toBe("my-server");
    expect(normalizeMcpName("My Server!")).toBe("My_Server_");
    expect(normalizeMcpName("server@1.0")).toBe("server_1_0");
  });

  test("preserves alphanumeric, underscore, and hyphen", () => {
    expect(normalizeMcpName("abc_123-def")).toBe("abc_123-def");
  });

  test("handles empty string", () => {
    expect(normalizeMcpName("")).toBe("");
  });
});

describe("createMcpTool", () => {
  let manager: McpClientManager;

  beforeEach(() => {
    manager = createMockManager();
  });

  test("creates a tool with correct naming convention", () => {
    const tool = createMcpTool("slack", mockToolInfo, manager);
    expect(tool.name).toBe("mcp__slack__search");
  });

  test("normalizes server name in tool name", () => {
    const tool = createMcpTool("My Server!", mockToolInfo, manager);
    expect(tool.name).toBe("mcp__My_Server___search");
  });

  test("uses tool description from MCP server", () => {
    const tool = createMcpTool("test", mockToolInfo, manager);
    expect(tool.description).toBe("Search the web for information");
  });

  test("truncates long descriptions to 2048 chars", () => {
    const longDesc = "x".repeat(3000);
    const tool = createMcpTool("test", { ...mockToolInfo, description: longDesc }, manager);
    expect(tool.description.length).toBe(2048);
  });

  test("accepts any input via passthrough schema", () => {
    const tool = createMcpTool("test", mockToolInfo, manager);
    // Should not throw for any object input
    const result = tool.inputSchema.safeParse({ anything: "goes", num: 42 });
    expect(result.success).toBe(true);
  });

  test("validateInput always returns ok", async () => {
    const tool = createMcpTool("test", mockToolInfo, manager);
    const result = await tool.validateInput({ query: "test" }, mockContext);
    expect(result.ok).toBe(true);
  });

  test("execute calls manager.callTool with correct params", async () => {
    const callTool = vi.fn().mockResolvedValue("search results");
    manager = createMockManager({ callTool });

    const tool = createMcpTool("slack", mockToolInfo, manager);
    const result = await tool.execute({ query: "hello" }, mockContext);

    expect(callTool).toHaveBeenCalledWith("slack", "search", { query: "hello" });
    expect(result.output).toBe("search results");
  });

  test("execute returns error result on failure", async () => {
    const callTool = vi.fn().mockRejectedValue(new Error("Connection lost"));
    manager = createMockManager({ callTool });

    const tool = createMcpTool("test", mockToolInfo, manager);
    const result = await tool.execute({ query: "test" }, mockContext);

    expect(result.error).toBe(true);
    expect(result.output).toContain("Connection lost");
  });

  test("checkPermissions returns ask by default", async () => {
    const tool = createMcpTool("test", mockToolInfo, manager);
    const decision = await tool.checkPermissions!(
      { query: "test" },
      mockContext,
      { toolName: "test", isMcp: true },
    );
    expect(decision).toEqual({ behavior: "ask" });
  });

  test("isReadOnly returns false for non-read-only tools", () => {
    const tool = createMcpTool("test", mockToolInfo, manager);
    expect(tool.isReadOnly?.({ query: "test" })).toBe(false);
  });

  test("isConcurrencySafe returns false for non-read-only tools", () => {
    const tool = createMcpTool("test", mockToolInfo, manager);
    expect(tool.isConcurrencySafe?.({ query: "test" })).toBe(false);
  });

  test("preserves original MCP inputSchema for API tool definitions", () => {
    const tool = createMcpTool("test", mockToolInfo, manager);
    // The tool must expose the MCP server's original inputSchema so the API
    // knows what parameters to send. Without this, the model sends {} or
    // guesses wrong parameter names, causing MCP server errors.
    expect(tool.apiInputSchema).toBeDefined();
    expect(tool.apiInputSchema!.type).toBe("object");
    expect(tool.apiInputSchema!.properties).toHaveProperty("query");
    expect(tool.apiInputSchema!.required).toContain("query");
  });

  test("apiInputSchema preserves complex nested schemas", () => {
    const complexSchema = {
      type: "object" as const,
      properties: {
        search_query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results" },
        filters: {
          type: "object",
          properties: {
            date_range: { type: "string" },
            source: { type: "string" },
          },
        },
      },
      required: ["search_query"],
    };
    const tool = createMcpTool("web-search", {
      ...mockToolInfo,
      inputSchema: complexSchema,
    }, manager);
    expect(tool.apiInputSchema).toEqual(complexSchema);
  });

  test("apiInputSchema defaults to empty object schema when not provided", () => {
    const tool = createMcpTool("test", {
      ...mockToolInfo,
      inputSchema: {},
    }, manager);
    expect(tool.apiInputSchema).toBeDefined();
    expect(tool.apiInputSchema!.type).toBe("object");
    expect(tool.apiInputSchema!.properties).toEqual({});
  });
});
