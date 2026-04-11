import { useState, useCallback, useRef } from "react";
import type { Message, AssistantMessage } from "../messages.js";
import { createUserMessage, createAssistantMessage } from "../messages.js";
import { streamChat, type APIConfig, type ContentBlockDeltaEvent } from "../services/api.js";

interface UseStreamResponseReturn {
  readonly isLoading: boolean;
  readonly streamingText: string | null;
  readonly sendMessage: (content: string) => Promise<void>;
  readonly cancel: () => void;
  readonly error: string | null;
}

export function useStreamResponse(
  messages: readonly Message[],
  setMessages: (updater: (prev: readonly Message[]) => readonly Message[]) => void,
  config: APIConfig,
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

      // 3. Accumulate streamed text
      let fullText = "";

      try {
        // Get all messages including the new one
        const allMessages = [...messagesRef.current, userMsg];

        for await (const event of streamChat(allMessages, config, controller.signal)) {
          if (event.type === "content_block_delta") {
            const delta = event as ContentBlockDeltaEvent;
            if (delta.delta.type === "text_delta" && delta.delta.text) {
              fullText += delta.delta.text;
              setStreamingText(fullText);
            }
          }
        }

        // 4. Create and append assistant message
        const assistantMsg: AssistantMessage = createAssistantMessage({
          content: [{ type: "text", text: fullText }],
          model: config.model,
          stopReason: "end_turn",
        });
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // User cancelled — save partial response if any
          if (fullText) {
            const partialMsg: AssistantMessage = createAssistantMessage({
              content: [{ type: "text", text: fullText + "\n\n[Cancelled]" }],
              model: config.model,
              stopReason: null,
            });
            setMessages((prev) => [...prev, partialMsg]);
          }
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
    [config, setMessages],
  );

  return { isLoading, streamingText, sendMessage, cancel, error };
}
