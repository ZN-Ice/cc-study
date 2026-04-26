import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
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
import { createDefaultRegistry, loadAndRegisterMcpTools } from "../tools/index.js";
import type { ToolContext } from "../tools/types.js";
import type { McpLoadResult } from "../tools/index.js";
import { PermissionManager } from "../permissions/manager.js";
import { getProjectSettingsPath } from "../permissions/config.js";
import { PermissionConfirm } from "./PermissionConfirm.js";
import { AgentProgress } from "./AgentProgress.js";

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

  // Create tool registry once (synchronous — built-in tools)
  const toolRegistry = useMemo(() => createDefaultRegistry(), []);
  // Bumped when MCP tools are loaded, so apiConfig.tools refreshes
  const [mcpRevision, setMcpRevision] = useState(0);
  const mcpLoadResultRef = useRef<McpLoadResult | null>(null);

  // Create permission manager with default rules (allow read-only, ask for writes/bash)
  const permissionManager = useMemo(() => {
    const pm = new PermissionManager();
    pm.loadFromConfig({
      allow: ["Read", "Glob", "Grep"],
    }, "session");
    return pm;
  }, []);

  // Load project-level .claude/settings.json on startup
  useEffect(() => {
    const projectSettingsPath = getProjectSettingsPath(process.cwd());
    permissionManager.loadFromSettingsFile(projectSettingsPath).catch(() => {
      // File doesn't exist or is invalid — fine, use defaults
    });
  }, [permissionManager]);

  // Load MCP servers asynchronously on mount
  useEffect(() => {
    let cancelled = false;
    loadAndRegisterMcpTools(toolRegistry, process.cwd())
      .then((result) => {
        if (cancelled) return;
        mcpLoadResultRef.current = result;
        if (result.toolCount > 0) {
          setMcpRevision((r) => r + 1);
        }
      })
      .catch(() => {
        // MCP loading failure should not block the app
      });
    return () => { cancelled = true; };
  }, [toolRegistry]);

  // Cleanup MCP connections on unmount
  useEffect(() => {
    return () => {
      mcpLoadResultRef.current?.clientManager.disconnectAll().catch(() => {});
    };
  }, []);

  const toolContext = useMemo<Partial<ToolContext>>(
    () => ({
      workingDirectory: process.cwd(),
    }),
    [],
  );

  // mcpRevision is included to force recompute when MCP tools are added
  const apiConfig: APIConfig = useMemo(() => ({
    apiKey: apiKey ?? resolveApiKey(),
    model,
    maxTokens: DEFAULT_API_CONFIG.maxTokens,
    systemPrompt: SYSTEM_PROMPT,
    temperature: DEFAULT_API_CONFIG.temperature,
    tools: toolRegistry.getToolDefinitions(),
    // mcpRevision is not used directly but forces memo invalidation
  }), [apiKey, model, toolRegistry, mcpRevision]);

  const { isLoading, streamingText, sendMessage, cancel, error, permissionRequest, respondToPermission, executingTools, activeAgents } =
    useStreamResponse(messages, setMessages, apiConfig, toolRegistry, toolContext, permissionManager);

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

      {/* Loading spinner (hidden when agents are running) */}
      {isLoading && activeAgents.length === 0 && executingTools.length === 0 && !permissionRequest && (
        <>
          {streamingText ? <Spinner mode="responding" /> : <Spinner mode="thinking" />}
        </>
      )}

      {/* Agent progress display (one per running sub-agent) */}
      {activeAgents.map((agent) => (
        <AgentProgress
          key={agent.agentId}
          agentType={agent.agentType}
          description={agent.description}
          toolUseCount={agent.toolUseCount}
          startTime={agent.startTime}
          recentTools={agent.recentTools}
        />
      ))}

      {/* Permission confirmation dialog */}
      {permissionRequest && (
        <Box marginTop={1}>
          <PermissionConfirm
            request={permissionRequest}
            onRespond={respondToPermission}
          />
        </Box>
      )}

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
