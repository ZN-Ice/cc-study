/**
 * Tests for SSE/HTTP transport support in MCP config and client
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock all MCP SDK transport modules
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
  StdioClientTransport: vi.fn().mockImplementation(() => ({ _type: "stdio" })),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn().mockImplementation((url: URL) => ({ _type: "sse", url: url.toString() })),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation((url: URL) => ({ _type: "http", url: url.toString() })),
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  ListToolsResultSchema: {},
  CallToolResultSchema: {},
}));

import { loadMcpConfig } from "../../../src/services/mcpConfig.js";
import { McpClientManager } from "../../../src/services/mcpClient.js";

// Access mock constructors after mock setup
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");

describe("MCP Config: extended transport types", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mcp-transport-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  test("parses stdio config (no type field)", () => {
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({
      mcpServers: { myServer: { command: "npx", args: ["-y", "server"] } },
    }));
    const cfg = loadMcpConfig(tmpDir)!;
    expect(cfg.mcpServers.myServer.command).toBe("npx");
    expect(cfg.mcpServers.myServer.type).toBeUndefined();
  });

  test("parses sse config with url and headers", () => {
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({
      mcpServers: {
        remote: {
          type: "sse",
          url: "http://localhost:3001/sse",
          headers: { "X-API-Key": "secret123" },
        },
      },
    }));
    const cfg = loadMcpConfig(tmpDir)!;
    expect(cfg.mcpServers.remote.type).toBe("sse");
    expect(cfg.mcpServers.remote.url).toBe("http://localhost:3001/sse");
    expect(cfg.mcpServers.remote.headers).toEqual({ "X-API-Key": "secret123" });
  });

  test("parses http config with url", () => {
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({
      mcpServers: {
        api: {
          type: "http",
          url: "http://localhost:3002/mcp",
        },
      },
    }));
    const cfg = loadMcpConfig(tmpDir)!;
    expect(cfg.mcpServers.api.type).toBe("http");
    expect(cfg.mcpServers.api.url).toBe("http://localhost:3002/mcp");
  });

  test("parses mixed stdio + sse + http servers", () => {
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({
      mcpServers: {
        local: { command: "node", args: ["server.js"] },
        sseRemote: { type: "sse", url: "http://sse.example.com/events" },
        httpRemote: { type: "http", url: "http://http.example.com/mcp", headers: { Authorization: "Bearer token" } },
      },
    }));
    const cfg = loadMcpConfig(tmpDir)!;
    expect(Object.keys(cfg.mcpServers)).toHaveLength(3);
  });
});

describe("McpClientManager: transport selection", () => {
  let manager: McpClientManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new McpClientManager();
    mockConnect.mockResolvedValue(undefined);
  });

  test("uses StdioClientTransport for stdio config (default)", async () => {
    await manager.connect("local", { command: "npx", args: ["server"] });
    expect(StdioClientTransport).toHaveBeenCalledOnce();
    expect(SSEClientTransport).not.toHaveBeenCalled();
    expect(StreamableHTTPClientTransport).not.toHaveBeenCalled();
  });

  test("uses SSEClientTransport for sse config", async () => {
    await manager.connect("remote", {
      type: "sse",
      url: "http://localhost:3001/sse",
    });
    expect(SSEClientTransport).toHaveBeenCalledOnce();
    expect(StdioClientTransport).not.toHaveBeenCalled();
    // Verify URL was passed
    const call = (SSEClientTransport as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0].toString()).toBe("http://localhost:3001/sse");
  });

  test("uses StreamableHTTPClientTransport for http config", async () => {
    await manager.connect("api", {
      type: "http",
      url: "http://localhost:3002/mcp",
    });
    expect(StreamableHTTPClientTransport).toHaveBeenCalledOnce();
    expect(StdioClientTransport).not.toHaveBeenCalled();
    const call = (StreamableHTTPClientTransport as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0].toString()).toBe("http://localhost:3002/mcp");
  });

  test("passes headers to SSE transport", async () => {
    await manager.connect("remote", {
      type: "sse",
      url: "http://localhost:3001/sse",
      headers: { "X-API-Key": "key123" },
    });
    expect(SSEClientTransport).toHaveBeenCalledOnce();
    const opts = (SSEClientTransport as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts.requestInit.headers).toHaveProperty("X-API-Key", "key123");
  });

  test("passes headers to HTTP transport", async () => {
    await manager.connect("api", {
      type: "http",
      url: "http://localhost:3002/mcp",
      headers: { Authorization: "Bearer token" },
    });
    expect(StreamableHTTPClientTransport).toHaveBeenCalledOnce();
    const opts = (StreamableHTTPClientTransport as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts.requestInit.headers).toHaveProperty("Authorization", "Bearer token");
  });

  test("fetches tools from SSE server after connecting", async () => {
    mockListTools.mockResolvedValue({
      tools: [{ name: "search", description: "Search", inputSchema: { type: "object" } }],
    });

    await manager.connect("remote", {
      type: "sse",
      url: "http://localhost:3001/sse",
    });
    const tools = await manager.fetchTools("remote");

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("search");
  });

  test("calls tool on HTTP server", async () => {
    mockCallTool.mockResolvedValue({
      content: [{ type: "text", text: "result" }],
      isError: false,
    });

    await manager.connect("api", {
      type: "http",
      url: "http://localhost:3002/mcp",
    });
    const result = await manager.callTool("api", "search", { q: "hello" });

    expect(result).toBe("result");
  });

  test("throws for invalid sse config (missing url)", async () => {
    await expect(
      manager.connect("bad", { type: "sse" } as never),
    ).rejects.toThrow();
  });

  test("throws for invalid http config (missing url)", async () => {
    await expect(
      manager.connect("bad", { type: "http" } as never),
    ).rejects.toThrow();
  });
});
