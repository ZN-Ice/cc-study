/**
 * MCP Integration Tests
 *
 * Tests the full MCP flow: config loading → connection → tool discovery → tool calling.
 * Uses mocked MCP SDK to avoid requiring real MCP servers.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock MCP SDK
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

import { loadMcpConfig } from "../../src/services/mcpConfig.js";
import { McpClientManager } from "../../src/services/mcpClient.js";
import { createMcpTool } from "../../src/tools/MCPTool.js";
import { ToolRegistry } from "../../src/tools/registry.js";

describe("MCP Integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = join(tmpdir(), `mcp-integration-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("full flow: config → connect → discover → register → call", async () => {
    // 1. Setup .mcp.json config
    const config = {
      mcpServers: {
        testServer: {
          command: "npx",
          args: ["-y", "test-mcp-server"],
        },
      },
    };
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify(config));

    // 2. Load config
    const loadedConfig = loadMcpConfig(tmpDir);
    expect(loadedConfig).not.toBeNull();
    expect(loadedConfig!.mcpServers.testServer.command).toBe("npx");

    // 3. Connect to server
    mockConnect.mockResolvedValue(undefined);
    const manager = new McpClientManager();
    await manager.connect("testServer", loadedConfig!.mcpServers.testServer);
    expect(manager.isConnected("testServer")).toBe(true);

    // 4. Discover tools
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: "echo",
          description: "Echo back the input",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"],
          },
          annotations: { readOnlyHint: true },
        },
      ],
    });

    const tools = await manager.fetchTools("testServer");
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("echo");
    expect(tools[0].annotations?.readOnlyHint).toBe(true);

    // 5. Create MCP tool adapter
    const mcpTool = createMcpTool("testServer", tools[0], manager);
    expect(mcpTool.name).toBe("mcp__testServer__echo");
    expect(mcpTool.isReadOnly?.({})).toBe(true);

    // 6. Register in ToolRegistry
    const registry = new ToolRegistry();
    registry.register(mcpTool);
    expect(registry.has("mcp__testServer__echo")).toBe(true);

    // 7. Call tool via registry
    mockCallTool.mockResolvedValue({
      content: [{ type: "text", text: "hello world" }],
      isError: false,
    });

    const result = await mcpTool.execute(
      { message: "hello" },
      { workingDirectory: tmpDir, abortSignal: new AbortController().signal },
    );
    expect(result.output).toBe("hello world");
    expect(result.error).toBeFalsy();
  });

  test("multiple servers: discover and call tools from different servers", async () => {
    const config = {
      mcpServers: {
        server1: { command: "cmd1", args: [] },
        server2: { command: "cmd2", args: ["--port", "3000"] },
      },
    };
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify(config));

    const loadedConfig = loadMcpConfig(tmpDir);
    expect(loadedConfig).not.toBeNull();

    mockConnect.mockResolvedValue(undefined);
    const manager = new McpClientManager();

    // Connect both servers
    await manager.connect("server1", loadedConfig!.mcpServers.server1);
    await manager.connect("server2", loadedConfig!.mcpServers.server2);

    // Different tools from each server
    mockListTools
      .mockResolvedValueOnce({
        tools: [{ name: "tool_a", description: "Tool A", inputSchema: { type: "object" } }],
      })
      .mockResolvedValueOnce({
        tools: [{ name: "tool_b", description: "Tool B", inputSchema: { type: "object" } }],
      });

    const allTools = await manager.fetchAllTools();
    expect(allTools.size).toBe(2);

    // Create adapters and register
    const registry = new ToolRegistry();
    for (const [serverName, serverTools] of allTools) {
      for (const toolInfo of serverTools) {
        registry.register(createMcpTool(serverName, toolInfo, manager));
      }
    }

    expect(registry.has("mcp__server1__tool_a")).toBe(true);
    expect(registry.has("mcp__server2__tool_b")).toBe(true);
    expect(registry.size).toBe(2);
  });

  test("tool call failure returns error result", async () => {
    const manager = new McpClientManager();
    mockConnect.mockResolvedValue(undefined);
    await manager.connect("test", { command: "cmd" });

    const toolInfo = {
      name: "failing-tool",
      description: "A tool that fails",
      inputSchema: { type: "object" },
    };

    const mcpTool = createMcpTool("test", toolInfo, manager);

    // Simulate connection loss during call
    mockCallTool.mockRejectedValue(new Error("Connection lost"));

    const result = await mcpTool.execute(
      {},
      { workingDirectory: tmpDir, abortSignal: new AbortController().signal },
    );

    expect(result.error).toBe(true);
    expect(result.output).toContain("Connection lost");
  });

  test("disconnect cleans up connection", async () => {
    const manager = new McpClientManager();
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);

    await manager.connect("test", { command: "cmd" });
    expect(manager.isConnected("test")).toBe(true);

    await manager.disconnect("test");
    expect(manager.isConnected("test")).toBe(false);
    expect(mockClose).toHaveBeenCalledOnce();
  });
});
