/**
 * Tool system exports.
 *
 * Re-exports all types, the registry, and all tool implementations.
 */

export type { Tool, ToolResult, ToolContext, ValidationResult, ToolDefinition } from "./types.js";
export { ToolRegistry, executeTool, executeToolWithPermissions } from "./registry.js";
export type { OnPermissionAsk } from "./registry.js";
export { FileReadTool } from "./FileReadTool.js";
export { FileWriteTool } from "./FileWriteTool.js";
export { FileEditTool } from "./FileEditTool.js";
export { BashTool } from "./BashTool.js";
export { GlobTool } from "./GlobTool.js";
export { GrepTool } from "./GrepTool.js";
export { AgentTool } from "./AgentTool/index.js";
export { SkillTool } from "./SkillTool/index.js";
export { createMcpTool, normalizeMcpName } from "./MCPTool.js";

import { ToolRegistry } from "./registry.js";
import { FileReadTool } from "./FileReadTool.js";
import { FileWriteTool } from "./FileWriteTool.js";
import { FileEditTool } from "./FileEditTool.js";
import { BashTool } from "./BashTool.js";
import { GlobTool } from "./GlobTool.js";
import { GrepTool } from "./GrepTool.js";
import { AgentTool } from "./AgentTool/index.js";
import { SkillTool } from "./SkillTool/index.js";
import { createMcpTool } from "./MCPTool.js";
import { loadMcpConfig } from "../services/mcpConfig.js";
import { McpClientManager } from "../services/mcpClient.js";

/** Create a registry with all core tools registered */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(FileReadTool);
  registry.register(FileWriteTool);
  registry.register(FileEditTool);
  registry.register(BashTool);
  registry.register(GlobTool);
  registry.register(GrepTool);
  registry.register(AgentTool);
  registry.register(SkillTool);
  return registry;
}

/** Result of loading MCP tools into a registry */
export interface McpLoadResult {
  /** Number of MCP tools registered */
  toolCount: number;
  /** Number of servers successfully connected */
  serverCount: number;
  /** Errors encountered (per-server) */
  errors: Array<{ server: string; error: string }>;
  /** The client manager (caller is responsible for cleanup) */
  clientManager: McpClientManager;
}

/**
 * Load MCP configuration, connect to servers, discover and register tools
 * into an existing ToolRegistry.
 *
 * Silently skips servers that fail to connect.
 * Returns a summary of what was loaded.
 */
export async function loadAndRegisterMcpTools(
  registry: ToolRegistry,
  cwd: string,
): Promise<McpLoadResult> {
  const result: McpLoadResult = {
    toolCount: 0,
    serverCount: 0,
    errors: [],
    clientManager: new McpClientManager(),
  };

  const config = loadMcpConfig(cwd);
  if (!config) return result;

  for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
    try {
      await result.clientManager.connect(serverName, serverConfig);
      const tools = await result.clientManager.fetchTools(serverName);

      for (const toolInfo of tools) {
        const tool = createMcpTool(serverName, toolInfo, result.clientManager);
        try {
          registry.register(tool);
          result.toolCount++;
        } catch {
          // Duplicate name — skip (built-in tools take precedence)
        }
      }

      result.serverCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ server: serverName, error: message });
    }
  }

  return result;
}
