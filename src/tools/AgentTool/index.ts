/**
 * AgentTool — spawn sub-agents as tool calls.
 *
 * References: free-code/src/tools/AgentTool/AgentTool.tsx
 *
 * Supports two paths:
 * 1. Normal path: explicit `subagent_type` → run inline agent via runSubAgent
 * 2. Fork path: `subagent_type` omitted + gate enabled → run forked agent via runForkedAgent
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
import {
  isForkSubagentEnabled,
  isInForkChild,
  FORK_AGENT,
  buildForkedMessages,
  buildWorktreeNotice,
} from "./forkSubagent.js";
import { runForkedAgent } from "../../utils/forkedAgent.js";
import type { AssistantMessage, Message } from "../../messages.js";
import { createAssistantMessage, createUserMessage } from "../../messages.js";

/** Counter for generating unique agent IDs within a session */
let agentIdCounter = 0;

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

    // In fork mode, subagent_type is optional (defaults to fork)
    const effectiveType = input.subagent_type ?? (isForkSubagentEnabled() ? undefined : "general-purpose");
    if (effectiveType === undefined) {
      // Fork path — no agent type validation needed
      return { ok: true };
    }

    const agentDef = agentDefinitions.get(effectiveType);
    if (!agentDef) {
      const available = agentDefinitions
        .getAll()
        .map((d) => d.agentType)
        .join(", ");
      return {
        ok: false,
        error: `Error: Unknown agent type "${effectiveType}". Available: ${available}`,
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

    // Fork subagent routing:
    // - subagent_type set → use it (explicit wins)
    // - subagent_type omitted, gate on → fork path (undefined)
    // - subagent_type omitted, gate off → default general-purpose
    const effectiveType = input.subagent_type ?? (isForkSubagentEnabled() ? undefined : "general-purpose");
    const isForkPath = effectiveType === undefined;

    if (isForkPath) {
      // Fork path
      return executeForkPath(input, apiConfig, parentRegistry, context);
    }

    // Normal path — existing logic
    return executeNormalPath(input, effectiveType, apiConfig, parentRegistry, context);
  },
};

/**
 * Execute the normal (non-fork) agent path.
 */
async function executeNormalPath(
  input: AgentToolInput,
  agentType: string,
  apiConfig: import("../../services/api.js").APIConfig,
  parentRegistry: import("../registry.js").ToolRegistry,
  context: ToolContext,
): Promise<ToolResult> {
  const agentDef = agentDefinitions.get(agentType) as AgentDefinition;

  try {
    const agentId = `agent-${agentType}-${++agentIdCounter}`;

    const result = await runSubAgent({
      agentDefinition: agentDef,
      prompt: input.prompt,
      apiConfig,
      parentRegistry,
      context,
      maxTurns: agentDef.maxTurns,
      agentId,
      description: input.description,
      onProgress: context.onAgentProgress,
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
}

/**
 * Execute the fork agent path.
 *
 * The fork child inherits the parent's conversation context and system prompt
 * for prompt cache sharing. It receives only a directive for its specific task.
 */
async function executeForkPath(
  input: AgentToolInput,
  apiConfig: import("../../services/api.js").APIConfig,
  parentRegistry: import("../registry.js").ToolRegistry,
  context: ToolContext,
): Promise<ToolResult> {
  const agentId = `agent-fork-${++agentIdCounter}`;

  try {
    // Recursive fork guard: check if we're already in a fork child
    // Note: we'd need access to parent messages for this check.
    // For now, the context doesn't carry the full message history,
    // so we rely on the isInForkChild check when messages are available.
    // This is a simplified version — full implementation would check
    // toolUseContext.messages or querySource.

    // Build a synthetic assistant message from the current context.
    // In the full implementation, this comes from the parent's current
    // assistant message that triggered this tool call.
    // For our simplified version, we create a minimal placeholder.
    const placeholderAssistant = createAssistantMessage({
      content: [
        { type: "text", text: `Starting fork agent for: ${input.description || input.prompt.slice(0, 50)}` },
      ],
      model: apiConfig.model,
    });

    // Build fork messages
    const promptMessages = buildForkedMessages(input.prompt, placeholderAssistant);

    // Build cache-safe params with parent's system prompt
    const cacheSafeParams = {
      systemPrompt: apiConfig.systemPrompt,
      parentMessages: [] as Message[], // Parent messages would be threaded from context
    };

    const result = await runForkedAgent({
      agentDefinition: FORK_AGENT,
      promptMessages,
      cacheSafeParams,
      apiConfig,
      parentRegistry,
      context,
      useExactTools: true, // Use exact parent tools for cache
      maxTurns: FORK_AGENT.maxTurns,
      agentId,
      description: input.description,
      onProgress: context.onAgentProgress,
    });

    return {
      output: result.content,
      metadata: {
        agentType: FORK_AGENT.agentType,
        durationMs: result.totalDurationMs,
      },
    };
  } catch (err) {
    if (context.abortSignal.aborted) {
      return {
        output: "Fork agent execution was cancelled",
        error: true,
      };
    }
    return {
      output: `Fork agent error: ${err instanceof Error ? err.message : String(err)}`,
      error: true,
    };
  }
}

/** Re-export agent definitions registry for testing */
export { agentDefinitions };
