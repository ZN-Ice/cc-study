import type { AgentDefinition } from "../../tools/AgentTool/types.js";
import type { ToolContext } from "../../tools/types.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { APIConfig } from "../../services/api.js";
import { runSubAgent } from "../../tools/AgentTool/orchestrator.js";
import { runWithTeammateContext, type TeammateContext } from "../teammateContext.js";
import { getTeamName } from "../teammate.js";
import {
  createIdleNotification,
  writeToMailbox,
} from "../teammateMailbox.js";
import { createDebug } from "../debug.js";

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
      onProgress: context.onAgentProgress,
    });

    return result;
  });

  // Send idle notification to team lead
  try {
    const teamName = getTeamName();
    debug("%s sending idle notification, teamName=%s", prefix, teamName);
    const notification = createIdleNotification(agentId, {
      idleReason: "available",
    });
    await writeToMailbox(
      "team-lead",
      {
        from: teammateContext.agentName,
        text: JSON.stringify(notification),
        timestamp: new Date().toISOString(),
      },
      teamName,
    );
    debug("%s idle notification sent", prefix);
  } catch {
    debug("%s idle notification failed", prefix);
    // Non-critical: idle notification failure should not break the runner
  }

  const durationMs = Date.now() - startTime;
  debug("%s completed — duration=%dms, contentLen=%d", prefix, durationMs, result.content.length);

  return {
    content: result.content,
    agentType: result.agentType,
    totalToolUseCount: result.totalToolUseCount,
    totalDurationMs: durationMs,
  };
}
