/**
 * MCP Server configuration loading.
 *
 * Reads MCP configuration from multiple sources (in priority order):
 * 1. Project .mcp.json (from cwd traversing up to root) — highest priority
 * 2. Global ~/.claude.json mcpServers section — lower priority
 *
 * Reference: free-code/src/services/mcp/config.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

/** MCP Server configuration for stdio transport */
export interface McpStdioConfig {
  /** Transport type (optional, defaults to stdio) */
  type?: "stdio";
  /** Command to execute */
  command: string;
  /** Command-line arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
}

/** MCP Server configuration for SSE transport */
export interface McpSSEConfig {
  type: "sse";
  /** SSE endpoint URL */
  url: string;
  /** Additional HTTP headers */
  headers?: Record<string, string>;
}

/** MCP Server configuration for Streamable HTTP transport */
export interface McpHTTPConfig {
  type: "http";
  /** HTTP endpoint URL */
  url: string;
  /** Additional HTTP headers */
  headers?: Record<string, string>;
}

/** Union of all supported MCP server configs */
export type McpServerConfig = McpStdioConfig | McpSSEConfig | McpHTTPConfig;

/** .mcp.json file format */
export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

/**
 * Merge two MCP config objects, with local config taking precedence over global.
 * Server entries from local override entries from global for the same server name.
 */
function mergeMcpConfigs(
  local: Record<string, McpServerConfig>,
  global: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  // Start with global servers
  const result: Record<string, McpServerConfig> = { ...global };
  // Local servers override global ones with the same name
  for (const [name, config] of Object.entries(local)) {
    result[name] = config;
  }
  return result;
}

/**
 * Load MCP configuration by searching for .mcp.json starting from `cwd`
 * and traversing up to the filesystem root, then merging with global config.
 *
 * Returns null if no valid config is found (neither .mcp.json nor ~/.claude.json).
 */
export function loadMcpConfig(cwd: string): McpConfigFile | null {
  let dir = cwd;
  let localServers: Record<string, McpServerConfig> = {};

  // Phase 1: Search for .mcp.json from cwd up to root
  while (true) {
    const configPath = join(dir, ".mcp.json");
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const mcpServers =
          parsed.mcpServers &&
          typeof parsed.mcpServers === "object"
            ? (parsed.mcpServers as Record<string, McpServerConfig>)
            : {};
        localServers = mcpServers;
        break; // Found closest .mcp.json, stop searching
      } catch {
        // Parse failure — continue searching parent
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break; // Reached filesystem root
    dir = parent;
  }

  // Phase 2: Check global ~/.claude.json for mcpServers
  let globalServers: Record<string, McpServerConfig> = {};
  const globalConfigPath = join(homedir(), ".claude.json");
  if (existsSync(globalConfigPath)) {
    try {
      const raw = readFileSync(globalConfigPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
        globalServers = parsed.mcpServers as Record<string, McpServerConfig>;
      }
    } catch {
      // Ignore parse errors for global config
    }
  }

  // If neither local nor global has servers, return null
  const mergedServers = mergeMcpConfigs(localServers, globalServers);
  if (Object.keys(mergedServers).length === 0) {
    return null;
  }

  return { mcpServers: mergedServers };
}
