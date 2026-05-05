import type { AgentDefinition } from "../../tools/AgentTool/types.js";
import type { ToolContext } from "../../tools/types.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { APIConfig } from "../../services/api.js";
import { runSubAgent } from "../../tools/AgentTool/orchestrator.js";
import { runWithTeammateContext, type TeammateContext } from "../teammateContext.js";
import { createDebug } from "../debug.js";
import { updateHeartbeat } from "./heartbeat.js";

const debug = createDebug("agent:runner");

export interface InProcessRunnerParams {
  agentDefinition: AgentDefinition;
  prompt: string;
  apiConfig: APIConfig;
  parentRegistry: ToolRegistry;
  context: ToolContext;
  teammateContext: TeammateContext;
  agentId: string;
  description?: string;
  maxTurns?: number;
}

export interface InProcessRunnerResult {
  content: string;
  agentType: string;
  totalToolUseCount: number;
  totalDurationMs: number;
}

export async function runInProcessTeammate(
  params: InProcessRunnerParams,
): Promise<InProcessRunnerResult> {
  const {
    agentDefinition,
    prompt,
    apiConfig,
    parentRegistry,
    context,
    teammateContext,
    agentId,
    description,
    maxTurns,
  } = params;

  const startTime = Date.now();
  const shortId = agentId.slice(-8);
  const prefix = `runner:${shortId}`;

  debug("%s starting", prefix);

  const result = await runWithTeammateContext(teammateContext, async () => {
    const result = await runSubAgent({
      agentDefinition,
      prompt,
      apiConfig,
      parentRegistry,
      context,
      maxTurns: maxTurns ?? agentDefinition.maxTurns,
      agentId,
      description,
      onProgress: (event) => {
        updateHeartbeat(agentId);
        context.onAgentProgress?.(event);
      },
    });

    return result;
  });

  // Completion notification is handled by withRunnerLifecycle in runnerRegistry.ts.
  // No need to send a separate idle_notification here — it would be an unreadable
  // message (no "Completed:" prefix) that clutters the leader's inbox.

  const durationMs = Date.now() - startTime;
  debug("%s completed — duration=%dms, contentLen=%d", prefix, durationMs, result.content.length);

  return {
    content: result.content,
    agentType: result.agentType,
    totalToolUseCount: result.totalToolUseCount,
    totalDurationMs: durationMs,
  };
}
