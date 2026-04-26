/**
 * Tests for MCP Client Manager
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock functions defined at module scope so they can be accessed in tests
const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    listTools: mockListTools,
    callTool: mockCallTool,
    getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
    getServerVersion: vi.fn().mockReturnValue({ name: "test", version: "1.0.0" }),
    setRequestHandler: vi.fn(),
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  ListToolsResultSchema: {},
  CallToolResultSchema: {},
}));

// Import AFTER mocks are set up
import { McpClientManager } from "../../../src/services/mcpClient.js";

describe("McpClientManager", () => {
  let manager: McpClientManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new McpClientManager();
  });

  describe("connect", () => {
    test("connects to a stdio MCP server", async () => {
      mockConnect.mockResolvedValue(undefined);

      await manager.connect("test", {
        command: "npx",
        args: ["-y", "test-server"],
      });

      expect(mockConnect).toHaveBeenCalledOnce();
      expect(manager.isConnected("test")).toBe(true);
    });

    test("throws on connection failure", async () => {
      mockConnect.mockRejectedValue(new Error("Connection refused"));

      await expect(
        manager.connect("bad", { command: "nonexistent-command" }),
      ).rejects.toThrow("Connection refused");
    });

    test("does not reconnect if already connected", async () => {
      mockConnect.mockResolvedValue(undefined);

      await manager.connect("test", { command: "cmd" });
      await manager.connect("test", { command: "cmd" });

      expect(mockConnect).toHaveBeenCalledOnce();
    });
  });

  describe("disconnect", () => {
    test("disconnects from a server", async () => {
      mockConnect.mockResolvedValue(undefined);
      mockClose.mockResolvedValue(undefined);

      await manager.connect("test", { command: "npx", args: ["test"] });
      await manager.disconnect("test");

      expect(mockClose).toHaveBeenCalledOnce();
      expect(manager.isConnected("test")).toBe(false);
    });

    test("disconnect is no-op for unknown server", async () => {
      await manager.disconnect("nonexistent");
      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe("disconnectAll", () => {
    test("disconnects all connected servers", async () => {
      mockConnect.mockResolvedValue(undefined);
      mockClose.mockResolvedValue(undefined);

      await manager.connect("server1", { command: "cmd1" });
      await manager.connect("server2", { command: "cmd2" });
      await manager.disconnectAll();

      expect(mockClose).toHaveBeenCalledTimes(2);
    });
  });

  describe("fetchTools", () => {
    test("fetches tools from a connected server", async () => {
      mockConnect.mockResolvedValue(undefined);
      mockListTools.mockResolvedValue({
        tools: [
          {
            name: "search",
            description: "Search the web",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
          {
            name: "get",
            description: "Get resource",
            inputSchema: {
              type: "object",
              properties: { id: { type: "string" } },
            },
          },
        ],
      });

      await manager.connect("test", { command: "cmd" });
      const tools = await manager.fetchTools("test");

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("search");
      expect(tools[0].description).toBe("Search the web");
      expect(tools[1].name).toBe("get");
    });

    test("throws for disconnected server", async () => {
      await expect(manager.fetchTools("nonexistent")).rejects.toThrow(
        "not connected",
      );
    });

    test("returns empty array when server has no tools", async () => {
      mockConnect.mockResolvedValue(undefined);
      mockListTools.mockResolvedValue({ tools: [] });

      await manager.connect("test", { command: "cmd" });
      const tools = await manager.fetchTools("test");

      expect(tools).toEqual([]);
    });
  });

  describe("callTool", () => {
    test("calls a tool on a connected server", async () => {
      mockConnect.mockResolvedValue(undefined);
      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: "result data" }],
        isError: false,
      });

      await manager.connect("test", { command: "cmd" });
      const result = await manager.callTool("test", "search", {
        query: "hello",
      });

      expect(result).toBe("result data");
      expect(mockCallTool).toHaveBeenCalledWith({
        name: "search",
        arguments: { query: "hello" },
      });
    });

    test("throws when tool returns isError", async () => {
      mockConnect.mockResolvedValue(undefined);
      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: "Something went wrong" }],
        isError: true,
      });

      await manager.connect("test", { command: "cmd" });
      await expect(
        manager.callTool("test", "fail-tool", {}),
      ).rejects.toThrow("Something went wrong");
    });

    test("throws for disconnected server", async () => {
      await expect(
        manager.callTool("nonexistent", "tool", {}),
      ).rejects.toThrow("not connected");
    });

    test("concatenates multiple text content blocks", async () => {
      mockConnect.mockResolvedValue(undefined);
      mockCallTool.mockResolvedValue({
        content: [
          { type: "text", text: "line 1" },
          { type: "text", text: "line 2" },
        ],
        isError: false,
      });

      await manager.connect("test", { command: "cmd" });
      const result = await manager.callTool("test", "tool", {});

      expect(result).toBe("line 1\nline 2");
    });
  });

  describe("fetchAllTools", () => {
    test("fetches tools from all connected servers", async () => {
      mockConnect.mockResolvedValue(undefined);
      mockListTools
        .mockResolvedValueOnce({
          tools: [{ name: "t1", description: "Tool 1", inputSchema: { type: "object" } }],
        })
        .mockResolvedValueOnce({
          tools: [{ name: "t2", description: "Tool 2", inputSchema: { type: "object" } }],
        });

      await manager.connect("s1", { command: "cmd1" });
      await manager.connect("s2", { command: "cmd2" });

      const allTools = await manager.fetchAllTools();
      expect(allTools.size).toBe(2);
      expect(allTools.get("s1")).toHaveLength(1);
      expect(allTools.get("s2")).toHaveLength(1);
    });
  });
});
