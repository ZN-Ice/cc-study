import { useState, useCallback, useRef, useEffect } from "react";
import type { Message, AssistantMessage, ToolUseBlock, ContentBlock } from "../messages.js";
import { createUserMessage, createAssistantMessage } from "../messages.js";
import { streamChat, type APIConfig, type StreamEvent, type APIUsage } from "../services/api.js";
import { addUsage, addAPIDuration, computeCost, getTotalCost, type TokenUsage } from "../cost-tracker.js";
import type { ToolRegistry, ToolContext } from "../tools/index.js";
import { executeAllToolBatches } from "../tools/orchestration.js";
import type { PermissionManager } from "../permissions/manager.js";
import type { PermissionDecision } from "../permissions/types.js";
import type { PermissionRequest } from "../components/PermissionConfirm.js";
import type { AgentProgressEvent } from "../tools/AgentTool/types.js";
import { getTeamName } from "../utils/teammate.js";
import { readTeammateResultsFromMailbox, type TeammateCompletionResult } from "../utils/teammateMailbox.js";
import { cancelAllRunners, detectStaleTeammates } from "../utils/teammate/runnerRegistry.js";

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
  /**
   * Check the mailbox for teammate results and stage them for injection.
   * Returns the number of results found. Results are injected into the
   * next user message sent via sendMessage().
   */
  readonly injectTeammateResults: () => Promise<number>;
  /** Latest API call token usage (null if no API call yet) */
  readonly tokenUsage: TokenUsage | null;
  /** Total session cost in cents */
  readonly totalCost: number;
  /** Duration of the last API call in milliseconds */
  readonly apiDurationMs: number | null;
  /** Recent tool execution durations (from last batch) */
  readonly toolDurations: readonly { name: string; durationMs: number }[];
  /** Total session duration in milliseconds */
  readonly sessionDuration: number;
  /** Reset session-level metrics (costs, token usage, durations) */
  readonly resetSessionMetrics: () => void;
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
): Promise<{ content: ContentBlock[]; stopReason: string | null; usage: APIUsage | null }> {
  const blocks: ContentBlock[] = [];
  let currentTextIndex = -1;
  let textBlockCount = 0;
  let currentToolIndex = -1;
  let toolInputJson = "";
  let toolBlock: { id: string; name: string } | null = null;
  let stopReason: string | null = null;
  let usage: APIUsage | null = null;

  for await (const event of stream) {
    switch (event.type) {
      case "message_start": {
        if (event.message.usage) {
          usage = event.message.usage;
        }
        break;
      }
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

  return { content: blocks, stopReason, usage };
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
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
  const [apiDurationMs, setApiDurationMs] = useState<number | null>(null);
  const [toolDurations, setToolDurations] = useState<readonly { name: string; durationMs: number }[]>([]);
  const sessionStartTimeRef = useRef(Date.now());

  const resetSessionMetrics = useCallback(() => {
    setTokenUsage(null);
    setApiDurationMs(null);
    setToolDurations([]);
    sessionStartTimeRef.current = Date.now();
  }, []);

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
   * Pending teammate results collected by external polling (App.tsx).
   * These are injected into the next user message so the LLM sees them.
   * Using a ref to avoid re-renders on every poll tick.
   */
  const pendingTeammateResultsRef = useRef<TeammateCompletionResult[]>([]);

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

    // Cancel all background teammates
    cancelAllRunners();

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
      // 1. Collect pending teammate results (injected by App.tsx polling)
      const pendingResults = pendingTeammateResultsRef.current;
      pendingTeammateResultsRef.current = [];

      // 2. Create user message with optional teammate results injected
      const userContentBlocks: ContentBlock[] = [{ type: "text", text: content }];
      if (pendingResults.length > 0) {
        const injectionTexts: string[] = [];
        for (const r of pendingResults) {
          injectionTexts.push(
            `<teammate-result teammate_id="${r.agentName}" agent_type="${r.agentType}" tool_use_count="${r.toolUseCount}" duration_ms="${r.durationMs}">\n${r.content}\n</teammate-result>`,
          );
        }
        userContentBlocks.push({
          type: "text",
          text: `\n\n--- Teammate Results ---\n${injectionTexts.join("\n\n")}`,
        });
      }
      const userMsg = createUserMessage(userContentBlocks);
      setMessages((prev) => [...prev, userMsg]);

      // 3. Setup abort controller
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
          let apiUsage: APIUsage | null;

          try {
            const t0 = Date.now();
            const stream = streamChat(conversationMessages, config, controller.signal);
            const result = await collectStreamResponse(stream, onText);
            const elapsed = Date.now() - t0;
            responseContent = result.content;
            stopReason = result.stopReason;
            apiUsage = result.usage;

            setApiDurationMs(elapsed);
            addAPIDuration(elapsed);

            if (apiUsage) {
              setTokenUsage({
                inputTokens: apiUsage.input_tokens,
                outputTokens: apiUsage.output_tokens,
                cacheCreationInputTokens: apiUsage.cache_creation_input_tokens,
                cacheReadInputTokens: apiUsage.cache_read_input_tokens,
              });
              const cost = computeCost({
                inputTokens: apiUsage.input_tokens,
                outputTokens: apiUsage.output_tokens,
                cacheCreationInputTokens: apiUsage.cache_creation_input_tokens,
                cacheReadInputTokens: apiUsage.cache_read_input_tokens,
              });
              addUsage({
                tokens: {
                  inputTokens: apiUsage.input_tokens,
                  outputTokens: apiUsage.output_tokens,
                  cacheCreationInputTokens: apiUsage.cache_creation_input_tokens,
                  cacheReadInputTokens: apiUsage.cache_read_input_tokens,
                },
                costCents: cost,
                durationMs: elapsed,
                model: config.model,
                timestamp: Date.now(),
              });
            }
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

            const batchDurations: { name: string; durationMs: number }[] = [];
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
              if (r.tool_name && r.durationMs !== undefined) {
                batchDurations.push({ name: r.tool_name, durationMs: r.durationMs });
              }
            }
            setToolDurations(batchDurations);

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

  /**
   * Check the mailbox for unread teammate results and stage them for
   * injection into the next user message. Also detects stale teammates
   * (no heartbeat for >45s) and injects a notification.
   * Returns the number of new items found (results + stale notifications).
   */
  const injectTeammateResults = useCallback(async (): Promise<number> => {
    try {
      const teamName = getTeamName();
      if (!teamName) return 0;

      let count = 0;

      // 1. Check for completion results
      const results = await readTeammateResultsFromMailbox(teamName);
      if (results.length > 0) {
        pendingTeammateResultsRef.current = [
          ...pendingTeammateResultsRef.current,
          ...results,
        ];
        count += results.length;
      }

      // 2. Check for stale (possibly crashed) teammates
      const stale = detectStaleTeammates();
      for (const s of stale) {
        const staleResult: TeammateCompletionResult = {
          agentName: s.agentName,
          content: `[WARNING] Teammate "${s.agentName}" has been unresponsive for ${Math.round(s.staleMs / 1000)}s (no heartbeat). It may be stuck or crashed. You can send a message to check, or cancel it.`,
          agentType: "teammate-stale",
          toolUseCount: 0,
          durationMs: s.staleMs,
        };
        // Avoid duplicate stale notifications for the same agent
        const alreadyPending = pendingTeammateResultsRef.current.some(
          (r) => r.agentType === "teammate-stale" && r.agentName === s.agentName,
        );
        if (!alreadyPending) {
          pendingTeammateResultsRef.current = [
            ...pendingTeammateResultsRef.current,
            staleResult,
          ];
          count++;
        }
      }

      return count;
    } catch {
      return 0;
    }
  }, []);

  return {
    isLoading, streamingText, sendMessage, cancel, error,
    permissionRequest, respondToPermission, executingTools, activeAgents,
    injectTeammateResults,
    tokenUsage,
    totalCost: getTotalCost(),
    apiDurationMs,
    toolDurations,
    sessionDuration: Date.now() - sessionStartTimeRef.current,
    resetSessionMetrics,
  };
}
