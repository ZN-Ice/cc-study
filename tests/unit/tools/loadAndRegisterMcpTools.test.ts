/**
 * Tests for loadAndRegisterMcpTools — the full MCP→Registry integration
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock MCP SDK
const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockListTools = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    listTools: mockListTools,
    callTool: vi.fn(),
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

import { ToolRegistry, loadAndRegisterMcpTools } from "../../../src/tools/index.js";

describe("loadAndRegisterMcpTools", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = join(tmpdir(), `mcp-registry-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns empty result when no .mcp.json exists", async () => {
    const registry = new ToolRegistry();
    const result = await loadAndRegisterMcpTools(registry, tmpDir);

    expect(result.toolCount).toBe(0);
    expect(result.serverCount).toBe(0);
    expect(result.errors).toEqual([]);
  });

  test("connects to servers and registers tools", async () => {
    // Write .mcp.json
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({
      mcpServers: {
        weather: { command: "npx", args: ["-y", "weather-server"] },
      },
    }));

    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({
      tools: [
        { name: "get_forecast", description: "Get weather forecast", inputSchema: { type: "object" } },
        { name: "get_alerts", description: "Get weather alerts", inputSchema: { type: "object" } },
      ],
    });

    const registry = new ToolRegistry();
    const result = await loadAndRegisterMcpTools(registry, tmpDir);

    expect(result.serverCount).toBe(1);
    expect(result.toolCount).toBe(2);
    expect(registry.has("mcp__weather__get_forecast")).toBe(true);
    expect(registry.has("mcp__weather__get_alerts")).toBe(true);
  });

  test("records errors for failed servers but continues", async () => {
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({
      mcpServers: {
        good: { command: "good-cmd" },
        bad: { command: "bad-cmd" },
      },
    }));

    mockConnect
      .mockResolvedValueOnce(undefined) // good server
      .mockRejectedValueOnce(new Error("spawn bad-cmd ENOENT")); // bad server

    mockListTools.mockResolvedValue({
      tools: [{ name: "tool1", description: "T1", inputSchema: { type: "object" } }],
    });

    const registry = new ToolRegistry();
    const result = await loadAndRegisterMcpTools(registry, tmpDir);

    expect(result.serverCount).toBe(1);
    expect(result.toolCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].server).toBe("bad");
    expect(result.errors[0].error).toContain("ENOENT");
    expect(registry.has("mcp__good__tool1")).toBe(true);
  });

  test("MCP tool names are namespaced, no conflict with built-ins", async () => {
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({
      mcpServers: {
        myServer: { command: "my-cmd" },
      },
    }));

    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({
      tools: [{ name: "Read", description: "MCP Read", inputSchema: { type: "object" } }],
    });

    // Register a built-in "Read" first
    const registry = new ToolRegistry();
    const { FileReadTool } = await import("../../../src/tools/FileReadTool.js");
    registry.register(FileReadTool);

    const result = await loadAndRegisterMcpTools(registry, tmpDir);

    // MCP tool gets mcp__ prefix, so no conflict
    expect(result.toolCount).toBe(1);
    expect(registry.get("Read")).toBe(FileReadTool);
    expect(registry.has("mcp__myServer__Read")).toBe(true);
  });

  test("handles multiple servers with tools", async () => {
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({
      mcpServers: {
        slack: { command: "slack-cmd" },
        github: { command: "github-cmd", args: ["--verbose"] },
      },
    }));

    mockConnect.mockResolvedValue(undefined);
    mockListTools
      .mockResolvedValueOnce({
        tools: [{ name: "send_message", description: "Send a message", inputSchema: { type: "object" } }],
      })
      .mockResolvedValueOnce({
        tools: [
          { name: "create_issue", description: "Create an issue", inputSchema: { type: "object" } },
          { name: "list_repos", description: "List repos", inputSchema: { type: "object" } },
        ],
      });

    const registry = new ToolRegistry();
    const result = await loadAndRegisterMcpTools(registry, tmpDir);

    expect(result.serverCount).toBe(2);
    expect(result.toolCount).toBe(3);
    expect(registry.has("mcp__slack__send_message")).toBe(true);
    expect(registry.has("mcp__github__create_issue")).toBe(true);
    expect(registry.has("mcp__github__list_repos")).toBe(true);
    expect(result.clientManager.isConnected("slack")).toBe(true);
    expect(result.clientManager.isConnected("github")).toBe(true);
  });

  test("handles empty mcpServers object", async () => {
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({ mcpServers: {} }));

    const registry = new ToolRegistry();
    const result = await loadAndRegisterMcpTools(registry, tmpDir);

    expect(result.toolCount).toBe(0);
    expect(result.serverCount).toBe(0);
  });

  test("traverses parent directories for .mcp.json", async () => {
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({
      mcpServers: {
        parent: { command: "parent-cmd" },
      },
    }));

    const childDir = join(tmpDir, "child", "nested");
    mkdirSync(childDir, { recursive: true });

    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({
      tools: [{ name: "tool", description: "T", inputSchema: { type: "object" } }],
    });

    const registry = new ToolRegistry();
    const result = await loadAndRegisterMcpTools(registry, childDir);

    expect(result.serverCount).toBe(1);
    expect(registry.has("mcp__parent__tool")).toBe(true);
  });

  test("returns clientManager for cleanup", async () => {
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({
      mcpServers: { srv: { command: "cmd" } },
    }));

    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({ tools: [] });

    const registry = new ToolRegistry();
    const result = await loadAndRegisterMcpTools(registry, tmpDir);

    expect(result.clientManager).toBeDefined();
    expect(result.clientManager.isConnected("srv")).toBe(true);
  });
});
