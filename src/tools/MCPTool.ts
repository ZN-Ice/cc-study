/**
 * MCP Tool adapter — converts MCP server tools into the internal Tool interface.
 *
 * Reference: free-code/src/tools/MCPTool/MCPTool.ts
 */

import { z } from "zod";
import type { Tool, ToolResult, ToolContext } from "./types.js";
import type { McpToolInfo, McpClientManager } from "../services/mcpClient.js";
import type { PermissionDecision, ToolPermissionContext } from "../permissions/types.js";

const MAX_DESCRIPTION_LENGTH = 2048;

/** MCP tool input schema — accepts any JSON object */
const McpInputSchema = z.object({}).passthrough();

/**
 * Normalize a name for use in MCP tool naming.
 * Replaces non-alphanumeric characters (except _ and -) with underscores.
 */
export function normalizeMcpName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Create an internal Tool from an MCP server tool definition.
 */
export function createMcpTool(
  serverName: string,
  toolInfo: McpToolInfo,
  clientManager: McpClientManager,
): Tool<typeof McpInputSchema> {
  const normalizedName = normalizeMcpName(serverName);
  const fullName = `mcp__${normalizedName}__${toolInfo.name}`;
  const description =
    toolInfo.description.length > MAX_DESCRIPTION_LENGTH
      ? toolInfo.description.slice(0, MAX_DESCRIPTION_LENGTH - 3) + "..."
      : toolInfo.description;

  return {
    name: fullName,
    description,
    inputSchema: McpInputSchema,

    async validateInput(): Promise<{ ok: true }> {
      return { ok: true };
    },

    async checkPermissions(
      _input: z.infer<typeof McpInputSchema>,
      _context: ToolContext,
      _permContext: ToolPermissionContext,
    ): Promise<PermissionDecision> {
      // MCP tools require user confirmation by default
      return { behavior: "ask" as const };
    },

    isReadOnly(): boolean {
      return toolInfo.annotations?.readOnlyHint ?? false;
    },

    isConcurrencySafe(): boolean {
      return toolInfo.annotations?.readOnlyHint ?? false;
    },

    async execute(
      input: z.infer<typeof McpInputSchema>,
      _context: ToolContext,
    ): Promise<ToolResult> {
      try {
        const result = await clientManager.callTool(
          serverName,
          toolInfo.name,
          input as Record<string, unknown>,
        );
        return { output: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { output: `MCP tool error: ${message}`, error: true };
      }
    },
  };
}
