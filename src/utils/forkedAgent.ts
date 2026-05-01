/**
 * Forked agent lifecycle — runs a child agent query loop with parent context.
 *
 * References: free-code/src/utils/forkedAgent.ts
 *
 * The forked agent inherits the parent's conversation context and system prompt
 * for prompt cache sharing, running its own streaming + tool-use loop in
 * isolation from the parent.
 *
 * Simplifications vs reference source:
 * - No usage tracking / analytics
 * - No sidechain transcript recording
 * - No content replacement state
 * - Simpler context isolation
 */

import type { Message, ContentBlock, ToolUseBlock } from "../messages.js";
import type { APIConfig } from "../services/api.js";
import { streamChat } from "../services/api.js";
import type { StreamEvent } from "../services/api.js";
import { createAssistantMessage, createUserMessage } from "../messages.js";
import type { ToolRegistry } from "../tools/registry.js";
import { executeAllToolBatches } from "../tools/orchestration.js";
import type { AgentDefinition, AgentToolResult, OnAgentProgress } from "../tools/AgentTool/types.js";
import { filterToolsForAgent } from "../tools/AgentTool/orchestrator.js";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

/** Parameters that must match the parent for prompt cache sharing. */
export interface CacheSafeParams {
  /** System prompt — must match parent for cache hits */
  systemPrompt: string;
  /** Parent context messages for cache sharing */
  parentMessages: Message[];
}

/** Parameters for running a forked agent. */
export interface ForkedAgentParams {
  /** The agent definition to use */
  agentDefinition: AgentDefinition;
  /** Initial prompt messages (built by buildForkedMessages) */
  promptMessages: Message[];
  /** Cache-safe parameters from parent */
  cacheSafeParams: CacheSafeParams;
  /** API configuration */
  apiConfig: APIConfig;
  /** Parent tool registry */
  parentRegistry: ToolRegistry;
  /** Tool execution context */
  context: {
    workingDirectory: string;
    abortSignal: AbortSignal;
    apiConfig?: APIConfig;
    toolRegistry?: ToolRegistry;
    onAgentProgress?: OnAgentProgress;
  };
  /** Whether to use exact parent tools (for cache) */
  useExactTools?: boolean;
  /** Maximum turns */
  maxTurns?: number;
  /** Agent instance ID */
  agentId: string;
  /** Description for progress callbacks */
  description?: string;
  /** Progress callback */
  onProgress?: OnAgentProgress;
  /** Optional worktree path override for cwd */
  worktreePath?: string;
}

/** Result from a forked agent run. */
export interface ForkedAgentResult {
  messages: Message[];
  content: string;
  totalDurationMs: number;
}

// ──────────────────────────────────────────────
// Stream Collection
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
              blocks.slice(0, i).filter((x) => x.type === "text").length === currentTextIndex,
          );
          if (textBlock && textBlock.type === "text") {
            (textBlock as { text: string }).text += delta.text;
          }
        } else if (delta.type === "input_json_delta" && delta.partial_json) {
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
// Text Extraction
// ──────────────────────────────────────────────

function extractTextFromMessages(messages: Message[]): string {
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

// ──────────────────────────────────────────────
// runForkedAgent
// ──────────────────────────────────────────────

/**
 * Run a forked agent with inherited parent context.
 *
 * Creates an isolated streaming loop that:
 * 1. Builds initial messages from parent context + fork prompt messages
 * 2. Uses the parent's system prompt (or fork-specific tools) for cache hits
 * 3. Runs its own streaming + tool-use loop
 * 4. Returns final text result
 */
export async function runForkedAgent(params: ForkedAgentParams): Promise<ForkedAgentResult> {
  const {
    agentDefinition,
    promptMessages,
    cacheSafeParams,
    apiConfig,
    parentRegistry,
    context,
    useExactTools,
    maxTurns,
    agentId,
    description,
    onProgress,
    worktreePath,
  } = params;

  const startTime = Date.now();
  const effectiveMaxTurns = maxTurns ?? agentDefinition.maxTurns ?? 200;

  // 1. Build tool pool: exact parent tools (for cache) or filtered
  const toolPool = useExactTools ? parentRegistry : filterToolsForAgent(parentRegistry, agentDefinition);

  // 2. Build API config with parent's system prompt
  const forkConfig: APIConfig = {
    ...apiConfig,
    systemPrompt: cacheSafeParams.systemPrompt,
    tools: toolPool.getToolDefinitions(),
  };

  // 3. Build initial messages: parent context + fork prompt
  const messages: Message[] = [...cacheSafeParams.parentMessages, ...promptMessages];

  let totalToolUseCount = 0;
  const recentTools: string[] = [];

  // Override working directory if worktree is set
  const effectiveCwd = worktreePath ?? context.workingDirectory;

  // 4. Streaming loop
  for (let turn = 0; turn < effectiveMaxTurns; turn++) {
    if (context.abortSignal.aborted) break;

    let responseContent: ContentBlock[];
    let stopReason: string | null;

    try {
      const stream = streamChat(messages, forkConfig, context.abortSignal);
      const result = await collectStreamResponse(stream);
      responseContent = result.content;
      stopReason = result.stopReason;
    } catch (err) {
      if (context.abortSignal.aborted) break;
      const content = extractTextFromMessages(messages);
      return {
        messages,
        content: content || `Fork agent error: ${err instanceof Error ? err.message : String(err)}`,
        totalDurationMs: Date.now() - startTime,
      };
    }

    const assistantMsg = createAssistantMessage({
      content: responseContent,
      model: apiConfig.model,
      stopReason,
    });
    messages.push(assistantMsg);

    const toolUseBlocks = responseContent.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0 || stopReason !== "tool_use") break;

    // Execute tools
    totalToolUseCount += toolUseBlocks.length;

    for (const toolUse of toolUseBlocks) {
      recentTools.push(`${toolUse.name}`);
    }
    while (recentTools.length > 5) recentTools.shift();

    onProgress?.({
      agentId,
      agentType: agentDefinition.agentType,
      description,
      toolUseCount: totalToolUseCount,
      startTime,
      recentTools: [...recentTools],
    });

    if (context.abortSignal.aborted) break;

    const toolContext = {
      ...context,
      workingDirectory: effectiveCwd,
    };

    const results = await executeAllToolBatches(toolUseBlocks, toolPool, toolContext);

    const toolResultBlocks: ContentBlock[] = results.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.tool_use_id,
      content: r.content,
      is_error: r.is_error,
    }));

    messages.push(createUserMessage(toolResultBlocks));
  }

  const content = extractTextFromMessages(messages);

  return {
    messages,
    content: content || "(Fork agent completed with no text output)",
    totalDurationMs: Date.now() - startTime,
  };
}
