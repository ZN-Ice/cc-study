import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import type { Message } from "../messages.js";
import { createSystemMessage } from "../messages.js";
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
import { StatusLine } from "./StatusLine.js";
import { executeCommand } from "../commands/executor.js";
import type { CommandContext } from "../commands/types.js";
import { loadAllSkills } from "../skills/loader.js";
import { initBundledSkills, getBundledSkills } from "../skills/index.js";
import { setSkillLookup } from "../tools/SkillTool/index.js";
import type { SkillCommand } from "../skills/types.js";
import { cancelAllRunners } from "../utils/teammate/runnerRegistry.js";
import { reset as resetCostTracker } from "../cost-tracker.js";

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

  // Skills state: loaded from .claude/skills/ + bundled skills
  const [loadedSkills, setLoadedSkills] = useState<SkillCommand[]>([]);
  // Init bundled skills once on mount
  useEffect(() => { initBundledSkills(); }, []);

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

  // Cleanup: disconnect MCP clients and cancel all teammate runners on unmount
  useEffect(() => {
    return () => {
      mcpLoadResultRef.current?.clientManager.disconnectAll().catch(() => {});
      cancelAllRunners();
    };
  }, []);

  // Load skills from directories + bundled registry on startup
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const userSkillsDir = `${process.env.HOME}/.claude/skills`;
      const projectSkillsDir = `${process.cwd()}/.claude/skills`;
      const { skills: dirSkills } = await loadAllSkills({
        userSkillsDir,
        projectSkillsDirs: [projectSkillsDir],
      });
      if (cancelled) return;

      const bundled = getBundledSkills();
      const all = [...bundled, ...dirSkills];
      setLoadedSkills(all);

      // Wire up SkillTool lookup and skill list for dynamic description
      setSkillLookup((name: string) => all.find((s) => s.name === name), all);
    })();
    return () => { cancelled = true; };
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

  const { isLoading, streamingText, sendMessage, cancel, error, permissionRequest, respondToPermission, executingTools, activeAgents, injectTeammateResults, tokenUsage, totalCost, sessionDuration, resetSessionMetrics } =
    useStreamResponse(messages, setMessages, apiConfig, toolRegistry, toolContext, permissionManager);

  // Keep a ref to sendMessage so polling can always call the latest version
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  // Poll for teammate results when idle, auto-send when results arrive
  const sendingRef = useRef(false); // prevent re-entrant sends
  useEffect(() => {
    if (isLoading) return;
    const interval = setInterval(async () => {
      if (sendingRef.current) return; // already sending from a previous poll
      try {
        const count = await injectTeammateResults();
        if (count > 0) {
          sendingRef.current = true;
          await sendMessageRef.current("");
        }
      } catch {
        // ignore
      } finally {
        sendingRef.current = false;
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isLoading, injectTeammateResults]);

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

    // Escape: cancel when loading, or two-press exit when idle
    if (key.escape) {
      if (isLoading) {
        cancel();
      } else {
        requestExit();
      }
      return;
    }
  });

  const executeSlashCommand = useCallback(
    async (input: string) => {
      const commandContext: CommandContext = {
        abortSignal: new AbortController().signal,
        workingDirectory: process.cwd(),
        canUseTool: (toolName: string) => toolRegistry.has(toolName),
        setMessages: (updater) => setMessages(updater),
        resetSession: () => {
          resetCostTracker();
          resetSessionMetrics();
        },
      };

      return executeCommand(input, commandContext, loadedSkills);
    },
    [toolRegistry, loadedSkills, setMessages, resetSessionMetrics],
  );

  const handleSubmit = useCallback(
    async (value: string) => {
      setInputValue("");

      // Check for slash command
      if (value.trim().startsWith("/")) {
        const result = await executeSlashCommand(value);
        if (result) {
          if (result.isSkill) {
            // Skill: send prompt content to the LLM for interactive processing
            void sendMessage(result.text);
          } else {
            // Builtin command: display result as a system message
            const systemMessage = createSystemMessage(result.text);
            setMessages((prev) => [...prev, systemMessage]);
          }
        }
        return;
      }

      // Regular message - send to API
      void sendMessage(value.trim());
    },
    [sendMessage, executeSlashCommand],
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
          tokenCount={agent.tokenCount}
          model={agent.model}
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
          skills={loadedSkills}
        />
      </Box>

      {/* Cancel / exit hints */}
      {isLoading && (
        <Text dimColor>  Press Ctrl+C to cancel</Text>
      )}
      {exitState.waitingForSecondPress && !isLoading && (
        <Text color="yellow">  Press Esc or Ctrl+C again to exit</Text>
      )}

      {/* Status line */}
      <StatusLine
        model={model}
        tokenUsage={tokenUsage}
        totalCost={totalCost}
        executingTools={executingTools}
        isLoading={isLoading}
        sessionDuration={sessionDuration}
      />
    </Box>
  );
};
