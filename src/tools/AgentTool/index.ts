/**
 * AgentTool — spawn sub-agents as tool calls.
 *
 * References: free-code/src/tools/AgentTool/AgentTool.tsx
 *
 * The AgentTool is just another Tool. When the LLM calls it, its execute()
 * method runs a nested streaming + tool-use loop via the orchestrator and
 * returns the final text result as a ToolResult.
 */

import type { Tool, ToolResult, ToolContext, ValidationResult } from "../types.js";
import {
  agentToolInputSchema,
  type AgentToolInput,
  type AgentDefinition,
} from "./types.js";
import { createDefaultAgentDefinitions } from "./agentDefs.js";
import { getAgentToolDescription } from "./prompt.js";
import { runSubAgent } from "./orchestrator.js";

// Create the default agent registry (module-level singleton)
const agentDefinitions = createDefaultAgentDefinitions();

export const AgentTool: Tool<typeof agentToolInputSchema> = {
  name: "Agent",
  description: getAgentToolDescription(agentDefinitions.getAll()),

  inputSchema: agentToolInputSchema,

  requiresConfirmation: false,

  async validateInput(
    input: AgentToolInput,
    _context: ToolContext,
  ): Promise<ValidationResult> {
    if (!input.prompt.trim()) {
      return { ok: false, error: "Error: prompt is required" };
    }

    const agentType = input.subagent_type ?? "general-purpose";
    const agentDef = agentDefinitions.get(agentType);
    if (!agentDef) {
      const available = agentDefinitions
        .getAll()
        .map((d) => d.agentType)
        .join(", ");
      return {
        ok: false,
        error: `Error: Unknown agent type "${agentType}". Available: ${available}`,
      };
    }

    return { ok: true };
  },

  isSearchOrReadCommand(_input: AgentToolInput): {
    isSearch: boolean;
    isRead: boolean;
  } {
    return { isSearch: false, isRead: false };
  },

  isReadOnly(_input: AgentToolInput): boolean {
    return false;
  },

  isConcurrencySafe(_input: AgentToolInput): boolean {
    return false;
  },

  async execute(
    input: AgentToolInput,
    context: ToolContext,
  ): Promise<ToolResult> {
    const agentType = input.subagent_type ?? "general-purpose";
    const agentDef = agentDefinitions.get(agentType) as AgentDefinition;

    // Resolve API config from context
    const apiConfig = context.apiConfig;
    if (!apiConfig) {
      return {
        output: "Error: API config not available in tool context",
        error: true,
      };
    }

    // Resolve parent registry from context
    const parentRegistry = context.toolRegistry;
    if (!parentRegistry) {
      return {
        output: "Error: Tool registry not available in tool context",
        error: true,
      };
    }

    try {
      const result = await runSubAgent({
        agentDefinition: agentDef,
        prompt: input.prompt,
        apiConfig,
        parentRegistry,
        context,
        maxTurns: agentDef.maxTurns,
      });

      return {
        output: result.content,
        metadata: {
          agentType: result.agentType,
          toolUseCount: result.totalToolUseCount,
          durationMs: result.totalDurationMs,
        },
      };
    } catch (err) {
      if (context.abortSignal.aborted) {
        return {
          output: "Agent execution was cancelled",
          error: true,
        };
      }
      return {
        output: `Agent execution error: ${err instanceof Error ? err.message : String(err)}`,
        error: true,
      };
    }
  },
};

/** Re-export agent definitions registry for testing */
export { agentDefinitions };
