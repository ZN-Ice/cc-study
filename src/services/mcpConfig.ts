/**
 * MCP Server configuration loading.
 *
 * Reads .mcp.json from the project directory (traversing up to root).
 * Reference: free-code/src/services/mcp/config.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

/** MCP Server configuration for stdio transport */
export interface McpServerConfig {
  /** Transport type (currently only stdio supported) */
  type?: "stdio";
  /** Command to execute */
  command: string;
  /** Command-line arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
}

/** .mcp.json file format */
export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

/**
 * Load MCP configuration by searching for .mcp.json starting from `cwd`
 * and traversing up to the filesystem root.
 *
 * Returns null if no valid .mcp.json is found.
 */
export function loadMcpConfig(cwd: string): McpConfigFile | null {
  let dir = cwd;

  while (true) {
    const configPath = join(dir, ".mcp.json");
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        // Accept any JSON; if mcpServers is missing, treat as empty
        const mcpServers =
          parsed.mcpServers &&
          typeof parsed.mcpServers === "object"
            ? (parsed.mcpServers as Record<string, McpServerConfig>)
            : {};
        return { mcpServers };
      } catch {
        // Parse failure — continue searching parent
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break; // Reached filesystem root
    dir = parent;
  }

  return null;
}
