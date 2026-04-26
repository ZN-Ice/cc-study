/**
 * MCP Client Manager — connects to MCP servers via stdio/SSE/HTTP transport,
 * discovers tools, and calls them via JSON-RPC.
 *
 * Reference: free-code/src/services/mcp/client.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { VERSION } from "../constants/version.js";
import type { McpServerConfig } from "./mcpConfig.js";

/** Tool information discovered from an MCP server */
export interface McpToolInfo {
  /** Original tool name on the server */
  name: string;
  /** Tool description */
  description: string;
  /** Input parameter JSON Schema */
  inputSchema: Record<string, unknown>;
  /** Tool annotations from the server */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
}

/** Connection state for a single MCP server */
interface McpConnection {
  client: Client;
  serverName: string;
}

/**
 * Manages connections to multiple MCP servers and provides
 * tool discovery and invocation.
 */
export class McpClientManager {
  private connections = new Map<string, McpConnection>();

  /**
   * Connect to an MCP server via the configured transport.
   */
  async connect(name: string, config: McpServerConfig): Promise<void> {
    if (this.connections.has(name)) {
      return; // Already connected
    }

    const transport = this.createTransport(config);

    const client = new Client(
      { name: "cc-study", version: VERSION },
      { capabilities: {} },
    );

    await client.connect(transport);

    this.connections.set(name, { client, serverName: name });
  }

  /**
   * Create the appropriate transport based on config type.
   */
  private createTransport(config: McpServerConfig): Transport {
    const configType = (config as { type?: string }).type;

    switch (configType) {
      case "sse": {
        const sseConfig = config as { url: string; headers?: Record<string, string> };
        if (!sseConfig.url) throw new Error("SSE config requires 'url'");
        return new SSEClientTransport(new URL(sseConfig.url), {
          requestInit: {
            headers: { ...sseConfig.headers },
          },
        });
      }
      case "http": {
        const httpConfig = config as { url: string; headers?: Record<string, string> };
        if (!httpConfig.url) throw new Error("HTTP config requires 'url'");
        return new StreamableHTTPClientTransport(new URL(httpConfig.url), {
          requestInit: {
            headers: { ...httpConfig.headers },
          },
        });
      }
      default: {
        // stdio (default)
        const stdioConfig = config as { command: string; args?: string[]; env?: Record<string, string> };
        return new StdioClientTransport({
          command: stdioConfig.command,
          args: stdioConfig.args ?? [],
          env: { ...process.env, ...stdioConfig.env } as Record<string, string>,
          stderr: "pipe",
        });
      }
    }
  }

  /**
   * Disconnect from a specific MCP server.
   */
  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;

    try {
      await conn.client.close();
    } catch {
      // Ignore close errors
    }
    this.connections.delete(name);
  }

  /**
   * Disconnect from all MCP servers.
   */
  async disconnectAll(): Promise<void> {
    const names = [...this.connections.keys()];
    await Promise.allSettled(names.map((n) => this.disconnect(n)));
  }

  /**
   * Fetch the list of tools from a connected MCP server.
   */
  async fetchTools(serverName: string): Promise<McpToolInfo[]> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`MCP server "${serverName}" not connected`);
    }

    const result = await conn.client.listTools();

    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as Record<string, unknown>,
      annotations: tool.annotations
        ? {
            readOnlyHint: tool.annotations.readOnlyHint,
            destructiveHint: tool.annotations.destructiveHint,
            openWorldHint: tool.annotations.openWorldHint,
          }
        : undefined,
    }));
  }

  /**
   * Call a tool on a connected MCP server.
   * Returns the text content of the result.
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`MCP server "${serverName}" not connected`);
    }

    const result = await conn.client.callTool({
      name: toolName,
      arguments: args,
    });

    if (result.isError) {
      const content = result.content as Array<{ type: string; text?: string }>;
      const errorText = content
        .filter((c) => c.type === "text" && c.text != null)
        .map((c) => c.text)
        .join("\n");
      throw new Error(errorText || "MCP tool returned error");
    }

    const content = result.content as Array<{ type: string; text?: string }>;
    return content
      .filter((c) => c.type === "text" && c.text != null)
      .map((c) => c.text)
      .join("\n");
  }

  /**
   * Fetch tools from all connected servers.
   */
  async fetchAllTools(): Promise<Map<string, McpToolInfo[]>> {
    const result = new Map<string, McpToolInfo[]>();
    const entries = [...this.connections.keys()];

    await Promise.allSettled(
      entries.map(async (name) => {
        try {
          const tools = await this.fetchTools(name);
          result.set(name, tools);
        } catch {
          // Skip failed servers
        }
      }),
    );

    return result;
  }

  /**
   * Check if a server is connected.
   */
  isConnected(name: string): boolean {
    return this.connections.has(name);
  }
}
