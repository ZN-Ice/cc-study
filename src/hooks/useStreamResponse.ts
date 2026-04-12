import { useState, useCallback, useRef } from "react";
import type { Message, AssistantMessage, ToolUseBlock, ContentBlock } from "../messages.js";
import { createUserMessage, createAssistantMessage } from "../messages.js";
import { streamChat, type APIConfig, type StreamEvent } from "../services/api.js";
import type { ToolRegistry, ToolContext } from "../tools/index.js";
import { executeTool } from "../tools/index.js";

interface UseStreamResponseReturn {
  readonly isLoading: boolean;
  readonly streamingText: string | null;
  readonly sendMessage: (content: string) => Promise<void>;
  readonly cancel: () => void;
  readonly error: string | null;
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
  let currentToolIndex = -1;
  let toolInputJson = "";
  let toolBlock: { id: string; name: string } | null = null;
  let stopReason: string | null = null;

  for await (const event of stream) {
    switch (event.type) {
      case "content_block_start": {
        const block = event.content_block;
        if (block.type === "text") {
          currentTextIndex = event.index;
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
  toolContext?: ToolContext,
): UseStreamResponseReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort("user-cancel");
    abortControllerRef.current = null;
    setIsLoading(false);
    setStreamingText(null);
  }, []);

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

          // Execute tools and collect results
          const toolResultBlocks: ContentBlock[] = [];
          for (const toolUse of toolUseBlocks) {
            if (controller.signal.aborted) break;

            if (!toolRegistry) {
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: "Error: Tool registry not available",
                is_error: true,
              });
              continue;
            }

            const ctx: ToolContext = toolContext ?? {
              workingDirectory: process.cwd(),
              abortSignal: controller.signal,
            };

            const result = await executeTool(toolRegistry, toolUse.name, toolUse.input, ctx);
            toolResultBlocks.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: result.output,
              is_error: result.error,
            });
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
        setIsLoading(false);
        setStreamingText(null);
        abortControllerRef.current = null;
      }
    },
    [config, setMessages, toolRegistry, toolContext],
  );

  return { isLoading, streamingText, sendMessage, cancel, error };
}
