/**
 * Agent orchestrator — runs a sub-agent streaming + tool-use loop.
 *
 * References: free-code/src/tools/AgentTool/runAgent.ts, agentToolUtils.ts
 *
 * This is the core of the agent subsystem. It:
 * 1. Builds a filtered tool pool from the parent registry
 * 2. Runs its own streaming loop (like useStreamResponse but without React)
 * 3. Executes tools within the sub-agent's allowed set
 * 4. Returns the final text result
 */

import type { AgentDefinition, AgentToolResult, OnAgentProgress } from "./types.js";
import type { ToolContext } from "../types.js";
import type { APIConfig } from "../../services/api.js";
import { ToolRegistry } from "../registry.js";
import { executeAllToolBatches } from "../orchestration.js";
import { streamChat } from "../../services/api.js";
import type { StreamEvent } from "../../services/api.js";
import { createUserMessage, createAssistantMessage } from "../../messages.js";
import type { Message, ContentBlock, ToolUseBlock } from "../../messages.js";

const DEFAULT_MAX_TURNS = 20;

// ──────────────────────────────────────────────
// Tool Filtering
// ──────────────────────────────────────────────

/**
 * Build a filtered ToolRegistry for the given agent definition.
 *
 * Logic:
 * 1. Start with all tools from parent registry
 * 2. Remove tools in disallowedTools
 * 3. If tools allowlist is defined, intersect with it
 */
export function filterToolsForAgent(
  parentRegistry: ToolRegistry,
  agentDef: AgentDefinition,
): ToolRegistry {
  const allTools = parentRegistry.getAll();
  const filtered = new ToolRegistry();

  // Step 1: Remove disallowed tools
  const disallowedSet = new Set(agentDef.disallowedTools ?? []);
  let candidates = allTools.filter((t) => !disallowedSet.has(t.name));

  // Step 2: If tools allowlist is defined, intersect
  if (agentDef.tools && agentDef.tools.length > 0) {
    const hasWildcard =
      agentDef.tools.length === 1 && agentDef.tools[0] === "*";
    if (!hasWildcard) {
      const allowedSet = new Set(agentDef.tools);
      candidates = candidates.filter((t) => allowedSet.has(t.name));
    }
  }

  // Step 3: Register in filtered registry
  for (const tool of candidates) {
    filtered.register(tool);
  }

  return filtered;
}

/**
 * Format a tool name + input as a short display string for UI.
 */
function formatToolShortDesc(
  toolName: string,
  input: Record<string, unknown>,
): string {
  switch (toolName) {
    case "Read": {
      const path = (input.file_path as string) ?? "?";
      return `Read: ${truncateBasename(path, 30)}`;
    }
    case "Write": {
      const path = (input.file_path as string) ?? "?";
      return `Write: ${truncateBasename(path, 30)}`;
    }
    case "Edit": {
      const path = (input.file_path as string) ?? "?";
      return `Edit: ${truncateBasename(path, 30)}`;
    }
    case "Bash": {
      const cmd = (input.command as string) ?? "";
      return `Bash: ${truncateBasename(cmd, 30)}`;
    }
    case "Glob": {
      const pattern = (input.pattern as string) ?? "";
      return `Glob: ${pattern}`;
    }
    case "Grep": {
      const pattern = (input.pattern as string) ?? "";
      return `Grep: ${truncateBasename(pattern, 30)}`;
    }
    default:
      return toolName;
  }
}

function truncateBasename(s: string, max: number): string {
  const parts = s.split("/");
  const base = parts[parts.length - 1] ?? s;
  return base.length > max ? base.slice(0, max - 1) + "…" : base;
}

// ──────────────────────────────────────────────
// Stream Collection (reused from useStreamResponse pattern)
// ──────────────────────────────────────────────

/**
 * Collect all content blocks and stop_reason from a stream.
 */
async function collectStreamResponse(
  stream: AsyncGenerator<StreamEvent, void>,
): Promise<{ content: ContentBlock[]; stopReason: string | null }> {
  const blocks: ContentBlock[] = [];
  let currentTextIndex = -1;
  let textBlockCount = 0;
  let currentToolIndex = -1;
  let toolInputJson = "";
  let toolBlock: { id: string; name: string } | null = null;
  let stopReason: string | null = null;

  for await (const event of stream) {
    switch (event.type) {
      case "content_block_start": {
        const block = event.content_block;
        if (block.type === "text") {
          currentTextIndex = textBlockCount;
          textBlockCount++;
          blocks.push({ type: "text", text: block.text ?? "" });
        } else if (block.type === "tool_use") {
          currentToolIndex = event.index;
          toolInputJson = "";
          toolBlock = { id: block.id ?? "", name: block.name ?? "" };
        }
        break;
      }
      case "content_block_delta": {
        const delta = event.delta;
        if (delta.type === "text_delta" && delta.text) {
          const textBlock = blocks.find(
            (b, i) =>
              b.type === "text" &&
              blocks
                .slice(0, i)
                .filter((x) => x.type === "text").length === currentTextIndex,
          );
          if (textBlock && textBlock.type === "text") {
            (textBlock as { text: string }).text += delta.text;
          }
        } else if (
          delta.type === "input_json_delta" &&
          delta.partial_json
        ) {
          toolInputJson += delta.partial_json;
        }
        break;
      }
      case "content_block_stop": {
        if (event.index === currentToolIndex && toolBlock) {
          let input: Record<string, unknown> = {};
          try {
            if (toolInputJson) {
              input = JSON.parse(toolInputJson) as Record<string, unknown>;
            }
          } catch {
            input = {};
          }
          blocks.push({
            type: "tool_use",
            id: toolBlock.id,
            name: toolBlock.name,
            input,
          });
          toolBlock = null;
          currentToolIndex = -1;
        }
        break;
      }
      case "message_delta": {
        if (event.delta.stop_reason) {
          stopReason = event.delta.stop_reason;
        }
        break;
      }
    }
  }

  return { content: blocks, stopReason };
}

// ──────────────────────────────────────────────
// Sub-Agent Runner
// ──────────────────────────────────────────────

export interface RunSubAgentParams {
  readonly agentDefinition: AgentDefinition;
  readonly prompt: string;
  readonly apiConfig: APIConfig;
  readonly parentRegistry: ToolRegistry;
  readonly context: ToolContext;
  readonly maxTurns?: number;
  /** Unique identifier for this agent instance */
  readonly agentId: string;
  /** Description of what this agent is doing (from tool input) */
  readonly description?: string;
  /** Callback for progress updates during agent execution */
  readonly onProgress?: OnAgentProgress;
  /**
   * Optional worktree path — overrides the agent's working directory.
   * When set, all tool executions within this agent use the worktree
   * directory instead of the parent's working directory.
   */
  readonly worktreePath?: string;
}

/**
 * Run a sub-agent with its own streaming + tool-use loop.
 *
 * This is a self-contained version of the tool-use loop from useStreamResponse,
 * but without React hooks or UI state — pure async/await.
 *
 * @returns AgentToolResult with the final text content and metadata
 */
export async function runSubAgent(params: RunSubAgentParams): Promise<AgentToolResult> {
  const {
    agentDefinition,
    prompt,
    apiConfig,
    parentRegistry,
    context,
    maxTurns,
    agentId,
    description,
    onProgress,
    worktreePath,
  } = params;

  const startTime = Date.now();
  const effectiveMaxTurns = maxTurns ?? agentDefinition.maxTurns ?? DEFAULT_MAX_TURNS;

  // 1. Build filtered tool pool
  const filteredRegistry = filterToolsForAgent(parentRegistry, agentDefinition);

  // 2. Build sub-agent API config
  const agentConfig: APIConfig = {
    ...apiConfig,
    systemPrompt: agentDefinition.getSystemPrompt(),
    tools: filteredRegistry.getToolDefinitions(),
  };

  // 3. Build initial messages
  const messages: Message[] = [createUserMessage(prompt)];

  let totalToolUseCount = 0;
  /** Last N tool executions for UI display */
  const recentTools: string[] = [];

  // Override working directory if worktree is set
  const effectiveCwd = worktreePath ?? context.workingDirectory;

  // 4. Streaming loop
  for (let turn = 0; turn < effectiveMaxTurns; turn++) {
    if (context.abortSignal.aborted) {
      break;
    }

    // Call API
    let responseContent: ContentBlock[];
    let stopReason: string | null;

    try {
      const stream = streamChat(messages, agentConfig, context.abortSignal);
      const result = await collectStreamResponse(stream);
      responseContent = result.content;
      stopReason = result.stopReason;
    } catch (err) {
      // If aborted, return what we have
      if (context.abortSignal.aborted) {
        break;
      }
      // API error — return partial result
      const content = extractTextFromMessages(messages);
      return {
        agentType: agentDefinition.agentType,
        content: content || `Agent error: ${err instanceof Error ? err.message : String(err)}`,
        totalToolUseCount,
        totalDurationMs: Date.now() - startTime,
      };
    }

    // Create assistant message
    const assistantMsg = createAssistantMessage({
      content: responseContent,
      model: apiConfig.model,
      stopReason,
    });
    messages.push(assistantMsg);

    // Check if there are tool_use blocks
    const toolUseBlocks = responseContent.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0 || stopReason !== "tool_use") {
      // No more tools to execute — done
      break;
    }

    // Execute tools using partition + batch strategy (concurrent for safe tools)
    totalToolUseCount += toolUseBlocks.length;

    // Update recent tools list (keep last 5)
    for (const toolUse of toolUseBlocks) {
      const shortDesc = formatToolShortDesc(toolUse.name, toolUse.input);
      recentTools.push(shortDesc);
    }
    while (recentTools.length > 5) {
      recentTools.shift();
    }

    // Emit progress to parent
    onProgress?.({
      agentId,
      agentType: agentDefinition.agentType,
      description,
      toolUseCount: totalToolUseCount,
      startTime,
      recentTools: [...recentTools],
    });

    if (context.abortSignal.aborted) break;

    const toolExecContext = {
      ...context,
      workingDirectory: effectiveCwd,
    };

    const results = await executeAllToolBatches(
      toolUseBlocks, filteredRegistry, toolExecContext,
    );

    const toolResultBlocks: ContentBlock[] = results.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.tool_use_id,
      content: r.content,
      is_error: r.is_error,
    }));

    // Create user message with tool results
    const toolResultMsg = createUserMessage(toolResultBlocks);
    messages.push(toolResultMsg);
  }

  // 5. Extract final text
  const content = extractTextFromMessages(messages);

  return {
    agentType: agentDefinition.agentType,
    content: content || "(Agent completed with no text output)",
    totalToolUseCount,
    totalDurationMs: Date.now() - startTime,
  };
}

/**
 * Extract text content from the last assistant message in the conversation.
 */
function extractTextFromMessages(messages: Message[]): string {
  // Find the last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === "assistant") {
      const textBlocks = msg.content.filter(
        (b): b is { type: "text"; text: string } => b.type === "text",
      );
      if (textBlocks.length > 0) {
        return textBlocks.map((b) => b.text).join("\n");
      }
    }
  }
  return "";
}
