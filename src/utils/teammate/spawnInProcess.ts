import { randomUUID } from "node:crypto";
import { createTeammateContext, type TeammateContext } from "../teammateContext.js";
import { generateAgentId } from "../teamHelper.js";

export interface InProcessSpawnConfig {
  name: string;
  teamName: string;
  prompt: string;
  color?: string;
  planModeRequired?: boolean;
  model?: string;
}

export interface InProcessSpawnOutput {
  success: boolean;
  agentId: string;
  taskId?: string;
  abortController?: AbortController;
  teammateContext?: TeammateContext;
  error?: string;
}

export function spawnInProcessTeammate(
  config: InProcessSpawnConfig,
): InProcessSpawnOutput {
  const { name, teamName, prompt, color, planModeRequired = false } = config;

  const agentId = generateAgentId(name, teamName);
  const taskId = randomUUID().slice(0, 8);

  try {
    const abortController = new AbortController();
    const parentSessionId = taskId;

    const teammateContext = createTeammateContext({
      agentId,
      agentName: name,
      teamName,
      color,
      planModeRequired,
      parentSessionId,
      abortController,
    });

    return {
      success: true,
      agentId,
      taskId,
      abortController,
      teammateContext,
    };
  } catch (error) {
    return {
      success: false,
      agentId,
      error: error instanceof Error ? error.message : "Unknown error during spawn",
    };
  }
}
