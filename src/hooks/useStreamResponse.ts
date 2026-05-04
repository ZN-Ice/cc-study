import { useState, useCallback, useRef, useEffect } from "react";
import type { Message, AssistantMessage, ToolUseBlock, ContentBlock } from "../messages.js";
import { createUserMessage, createAssistantMessage } from "../messages.js";
import { streamChat, type APIConfig, type StreamEvent } from "../services/api.js";
import type { ToolRegistry, ToolContext } from "../tools/index.js";
import { executeAllToolBatches } from "../tools/orchestration.js";
import type { PermissionManager } from "../permissions/manager.js";
import type { PermissionDecision } from "../permissions/types.js";
import type { PermissionRequest } from "../components/PermissionConfirm.js";
import type { AgentProgressEvent } from "../tools/AgentTool/types.js";

interface UseStreamResponseReturn {
  readonly isLoading: boolean;
  readonly streamingText: string | null;
  readonly sendMessage: (content: string) => Promise<void>;
  readonly cancel: () => void;
  readonly error: string | null;
  /** Current permission request awaiting user response, or null */
  readonly permissionRequest: PermissionRequest | null;
  /** Callback to respond to a permission request */
  readonly respondToPermission: (allowed: boolean, alwaysAllow: boolean) => void;
  /** Names of tools currently being executed */
  readonly executingTools: readonly string[];
  /** Active agent progress entries (one per running sub-agent) */
  readonly activeAgents: readonly AgentProgressEvent[];
}

/** A pending permission request entry in the queue */
interface PendingPermissionEntry {
  request: PermissionRequest;
  resolve: (result: { allowed: boolean; alwaysAllow: boolean }) => void;
}

/**
 * Extract tool-specific details from a tool's input for permission display.
 * Returns subtitle (one-line summary) and content (detail text).
 */
export function extractToolPermissionDetails(
  toolName: string,
  rawInput: Record<string, unknown>,
): { subtitle?: string; content?: string } {
  switch (toolName) {
    case "Agent": {
      const hasTeamName = rawInput.team_name !== undefined;
      // Teammates always display as "teammate" regardless of subagent_type
      const subagentType = hasTeamName
        ? "teammate"
        : ((rawInput.subagent_type as string) ?? "general-purpose");
      const description = (rawInput.description as string) ?? "";
      return {
        subtitle: `Type: ${subagentType}${description ? ` — ${description}` : ""}`,
        content: undefined,
      };
    }
    case "Bash":
      return {
        subtitle: undefined,
        content: (rawInput.command as string) ?? undefined,
      };
    case "Read":
    case "Write":
    case "Edit":
      return {
        subtitle: undefined,
        content: (rawInput.file_path as string) ?? undefined,
      };
    case "Grep":
      return {
        subtitle: undefined,
        content: (rawInput.pattern as string) ?? undefined,
      };
    case "Glob":
      return {
        subtitle: undefined,
        content: (rawInput.pattern as string) ?? undefined,
      };
    default:
      return { subtitle: undefined, content: undefined };
  }
}

/**
 * Collect all content blocks and stop_reason from a stream.
 * Handles text_delta, input_json_delta, and content_block_start events.
 */
async function collectStreamResponse(
  stream: AsyncGenerator<StreamEvent, void>,
  onText: (text: string) => void,
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
            (b, i) => b.type === "text" && blocks.slice(0, i).filter((x) => x.type === "text").length === currentTextIndex,
          );
          if (textBlock && textBlock.type === "text") {
            (textBlock as { text: string }).text += delta.text;
            onText(textBlock.text);
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

export function useStreamResponse(
  messages: readonly Message[],
  setMessages: (updater: (prev: readonly Message[]) => readonly Message[]) => void,
  config: APIConfig,
  toolRegistry?: ToolRegistry,
  toolContext?: Partial<ToolContext>,
  permissionManager?: PermissionManager,
): UseStreamResponseReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executingTools, setExecutingTools] = useState<readonly string[]>([]);
  const [activeAgents, setActiveAgents] = useState<readonly AgentProgressEvent[]>([]);
  /**
   * Queue of pending permission requests from concurrent sub-agents.
   * State-based so React re-renders on every queue change, ensuring
   * the UI always reflects the current front of the queue.
   */
  const [pendingQueue, setPendingQueue] = useState<readonly PendingPermissionEntry[]>([]);
  /**
   * Ref that always holds the latest pendingQueue.
   * Used by callbacks (respondToPermission, cancel, sendMessage) to avoid
   * stale closures over the queue state. React state updates are async and
   * batched, so callbacks created with useCallback may close over an old
   * pendingQueue snapshot. The ref is updated synchronously on every render.
   */
  const pendingQueueRef = useRef<readonly PendingPermissionEntry[]>([]);
  pendingQueueRef.current = pendingQueue;

  /** permissionRequest is kept for API compat but derived from pendingQueue */
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  /**
   * Sync permissionRequest with pendingQueue front.
   * This ensures the UI always shows the front of the queue.
   */
  useEffect(() => {
    setPermissionRequest(pendingQueue.length > 0 ? pendingQueue[0]!.request : null);
  }, [pendingQueue]);

  /** User responds to a permission prompt from the UI */
  const respondToPermission = useCallback(
    (allowed: boolean, alwaysAllow: boolean) => {
      // Use ref to always get the latest queue — avoids stale closure
      const queue = pendingQueueRef.current;
      if (queue.length === 0) return;

      // Resolve the FIRST pending request (FIFO)
      const [head, ...rest] = queue;
      head!.resolve({ allowed, alwaysAllow });

      // Update queue state — React will re-render and permissionRequest will update
      setPendingQueue(rest);
    },
    [], // No dependencies — reads from ref
  );

  /** onPermissionAsk callback for executeToolWithPermissions */
  const onPermissionAsk = useCallback(
    async (
      decision: PermissionDecision,
      toolName: string,
      rawInput: Record<string, unknown>,
    ): Promise<{ allowed: boolean; alwaysAllow: boolean }> => {
      // Extract tool-specific details for richer permission display
      const details = extractToolPermissionDetails(toolName, rawInput);

      return new Promise((resolve) => {
        const request: PermissionRequest = {
          toolName,
          message: decision.message,
          content: details.content,
          subtitle: details.subtitle,
        };

        // Append to queue — state update triggers re-render, currentPermission auto-updates
        setPendingQueue((prev) => [...prev, { request, resolve }]);
      });
    },
    [],
  );

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort("user-cancel");

    // Use ref to always get the latest queue — avoids stale closure
    const queue = pendingQueueRef.current;
    for (const pending of queue) {
      pending.resolve({ allowed: false, alwaysAllow: false });
    }
    setPendingQueue([]);

    abortControllerRef.current = null;
    setIsLoading(false);
    setStreamingText(null);
  }, []); // No dependencies — reads from ref

  const sendMessage = useCallback(
    async (content: string) => {
      // 1. Create and append user message
      const userMsg = createUserMessage(content);
      setMessages((prev) => [...prev, userMsg]);

      // 2. Setup abort controller
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsLoading(true);
      setStreamingText(null);
      setError(null);

      // Build conversation starting from the new user message
      const conversationMessages: Message[] = [...messagesRef.current, userMsg];

      try {
        // Tool-use loop: keep calling API until we get end_turn (no more tool_use)
        let continueLoop = true;

        while (continueLoop) {
          if (controller.signal.aborted) break;

          // Reset streaming text for each API call
          let fullText = "";
          const onText = (text: string) => {
            fullText = text;
            setStreamingText(fullText);
          };

          let responseContent: ContentBlock[];
          let stopReason: string | null;

          try {
            const stream = streamChat(conversationMessages, config, controller.signal);
            const result = await collectStreamResponse(stream, onText);
            responseContent = result.content;
            stopReason = result.stopReason;
          } catch (err) {
            // If aborted during stream, save partial response as cancelled
            if (err instanceof DOMException && err.name === "AbortError" && fullText) {
              const partialMsg: AssistantMessage = createAssistantMessage({
                content: [{ type: "text", text: fullText + "\n\n[Cancelled]" }],
                model: config.model,
                stopReason: null,
              });
              setMessages((prev) => [...prev, partialMsg]);
            }
            throw err;
          }

          // Create assistant message
          const assistantMsg: AssistantMessage = createAssistantMessage({
            content: responseContent,
            model: config.model,
            stopReason,
          });
          conversationMessages.push(assistantMsg);
          setMessages((prev) => [...prev, assistantMsg]);

          // Check if there are tool_use blocks to execute
          const toolUseBlocks = responseContent.filter(
            (b): b is ToolUseBlock => b.type === "tool_use",
          );

          if (toolUseBlocks.length === 0 || stopReason !== "tool_use") {
            // No tools to execute, we're done
            continueLoop = false;
            break;
          }

          // Execute tools using partition + batch strategy
          const toolResultBlocks: ContentBlock[] = [];

          if (!toolRegistry) {
            for (const toolUse of toolUseBlocks) {
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: "Error: Tool registry not available",
                is_error: true,
              });
            }
          } else {
            const ctx: ToolContext = {
              workingDirectory: toolContext?.workingDirectory ?? process.cwd(),
              abortSignal: controller.signal,
              apiConfig: config,
              toolRegistry: toolRegistry,
              onAgentProgress: (event) => {
                setActiveAgents((prev) => {
                  // Update existing agent or add new one
                  const existing = prev.findIndex((a) => a.agentId === event.agentId);
                  if (existing >= 0) {
                    const next = [...prev];
                    next[existing] = event;
                    return next;
                  }
                  return [...prev, event];
                });
              },
            };

            if (controller.signal.aborted) break;

            // Track which tools are being executed
            const toolNames = toolUseBlocks.map((t) => t.name);
            setExecutingTools(toolNames);

            const results = await executeAllToolBatches(
              toolUseBlocks, toolRegistry, ctx,
              permissionManager, onPermissionAsk,
            );

            for (const r of results) {
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: r.tool_use_id,
                content: r.content,
                is_error: r.is_error,
                tool_name: r.tool_name,
                tool_input: r.tool_input,
                metadata: r.metadata,
              });
            }

            // Clear executing tools and active agents
            setExecutingTools([]);
            setActiveAgents([]);
          }

          // Create user message with tool results
          const toolResultMsg = createUserMessage(toolResultBlocks);
          conversationMessages.push(toolResultMsg);
          setMessages((prev) => [...prev, toolResultMsg]);

          // Clear streaming text before next API call
          setStreamingText(null);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // User cancelled — partial response already saved in inner catch
        } else {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
        }
      } finally {
        // Clear pending permission queue — use ref to avoid stale closure
        for (const pending of pendingQueueRef.current) {
          pending.resolve({ allowed: false, alwaysAllow: false });
        }
        setPendingQueue([]);

        setIsLoading(false);
        setStreamingText(null);
        setExecutingTools([]);
        setActiveAgents([]);
        abortControllerRef.current = null;
      }
    },
    [config, setMessages, toolRegistry, toolContext],
  );

  return { isLoading, streamingText, sendMessage, cancel, error, permissionRequest, respondToPermission, executingTools, activeAgents };
}
