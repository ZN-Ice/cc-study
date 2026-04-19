import React, { useState, useCallback, useRef, useMemo } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { Message } from "../messages.js";
import { PromptInput } from "./PromptInput.js";
import { MessageList } from "./MessageList.js";
import { Spinner } from "./Spinner.js";
import { useStreamResponse } from "../hooks/useStreamResponse.js";
import { SYSTEM_PROMPT, DEFAULT_API_CONFIG } from "../constants/prompts.js";
import { VERSION } from "../constants/version.js";
import type { APIConfig } from "../services/api.js";
import { resolveApiKey } from "../services/api.js";
import { twoPressReducer } from "../utils/twoPressExit.js";
import type { TwoPressExitState } from "../utils/twoPressExit.js";
import { createDefaultRegistry } from "../tools/index.js";
import type { ToolContext } from "../tools/types.js";

interface AppProps {
  readonly model: string;
  readonly debug: boolean;
  readonly apiKey?: string;
}

export const App: React.FC<AppProps> = ({ model, debug, apiKey }) => {
  const { exit } = useApp();
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [exitState, setExitState] = useState<TwoPressExitState>({
    waitingForSecondPress: false,
  });
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create tool registry once
  const toolRegistry = useMemo(() => createDefaultRegistry(), []);
  const toolContext = useMemo<Partial<ToolContext>>(
    () => ({
      workingDirectory: process.cwd(),
    }),
    [],
  );

  const apiConfig: APIConfig = {
    apiKey: apiKey ?? resolveApiKey(),
    model,
    maxTokens: DEFAULT_API_CONFIG.maxTokens,
    systemPrompt: SYSTEM_PROMPT,
    temperature: DEFAULT_API_CONFIG.temperature,
    tools: toolRegistry.getToolDefinitions(),
  };

  const { isLoading, streamingText, sendMessage, cancel, error } =
    useStreamResponse(messages, setMessages, apiConfig, toolRegistry, toolContext);

  const requestExit = useCallback(() => {
    const result = twoPressReducer(exitState, "press");
    setExitState(result.state);

    if (result.shouldExit) {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      exit();
    } else if (result.shouldShowHint) {
      exitTimerRef.current = setTimeout(() => {
        setExitState((prev) => twoPressReducer(prev, "timeout").state);
      }, 2000);
    }
  }, [exit, exitState]);

  // Global key handling
  useInput((_input, key) => {
    // Ctrl+C: cancel streaming (when loading) or quit (when idle)
    if (_input === "c" && key.ctrl) {
      if (isLoading) {
        cancel();
      } else {
        requestExit();
      }
      return;
    }

    // Escape: same two-press exit logic when idle
    if (key.escape && !isLoading) {
      requestExit();
    }
  });

  const handleSubmit = useCallback(
    (value: string) => {
      setInputValue("");
      void sendMessage(value.trim());
    },
    [sendMessage],
  );

  const handleChange = useCallback((value: string) => {
    setInputValue(value);
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="green" bold>
          cc-study v{VERSION}
        </Text>
        <Text dimColor> | model: {model}</Text>
        {debug && <Text color="yellow"> | DEBUG</Text>}
      </Box>

      {/* Message area */}
      <MessageList messages={messages} streamingText={streamingText} />

      {/* Error display */}
      {error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {/* Loading spinner */}
      {isLoading && !streamingText && <Spinner mode="thinking" />}
      {isLoading && streamingText && <Spinner mode="responding" />}

      {/* Input */}
      <Box marginTop={1}>
        <PromptInput
          value={inputValue}
          onChange={handleChange}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          placeholder={isLoading ? "Waiting for response..." : "Type a message... (Esc to quit)"}
        />
      </Box>

      {/* Cancel / exit hints */}
      {isLoading && (
        <Text dimColor>  Press Ctrl+C to cancel</Text>
      )}
      {exitState.waitingForSecondPress && !isLoading && (
        <Text color="yellow">  Press Esc or Ctrl+C again to exit</Text>
      )}
    </Box>
  );
};
