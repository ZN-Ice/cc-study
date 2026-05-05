import { randomUUID } from "node:crypto";
import type { AgentDefinition } from "../../tools/AgentTool/types.js";
import type { ToolContext } from "../../tools/types.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { APIConfig } from "../../services/api.js";
import { createTeammateContext, type TeammateContext } from "../teammateContext.js";
import { generateAgentId, readTeamFile, writeTeamFileSync, type TeamMember } from "../teamHelper.js";
import { runInProcessTeammate } from "./inProcessRunner.js";
import { registerRunner, withRunnerLifecycle } from "./runnerRegistry.js";

export interface InProcessSpawnConfig {
  name: string;
  teamName: string;
  prompt: string;
  color?: string;
  planModeRequired?: boolean;
  model?: string;
  agentDefinition: AgentDefinition;
  apiConfig: APIConfig;
  parentRegistry: ToolRegistry;
  context: ToolContext;
  description?: string;
  maxTurns?: number;
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
  const {
    name, teamName, color,
    planModeRequired = false,
  } = config;

  const agentId = generateAgentId(name, teamName);
  const taskId = randomUUID().slice(0, 8);
  const abortController = new AbortController();

  try {
    const teammateContext = createTeammateContext({
      agentId,
      agentName: name,
      teamName,
      color,
      planModeRequired,
      parentSessionId: taskId,
      abortController,
    });

    const runnerPromise = runInProcessTeammate({
      agentDefinition: config.agentDefinition,
      prompt: config.prompt,
      apiConfig: config.apiConfig,
      parentRegistry: config.parentRegistry,
      context: {
        ...config.context,
        abortSignal: abortController.signal,
      },
      teammateContext,
      agentId,
      description: config.description,
      maxTurns: config.maxTurns,
    });

    const lifecyclePromise = withRunnerLifecycle(
      agentId,
      name,
      teamName,
      runnerPromise,
    );

    registerRunner({
      agentId,
      agentName: name,
      teamName,
      abortController,
      promise: lifecyclePromise,
    });

    // Add this teammate to the team.json members list so send_message can find it
    try {
      const teamFile = readTeamFile(teamName);
      if (teamFile) {
        // Check if already registered (avoid duplicates on re-spawn)
        const alreadyRegistered = teamFile.members.some((m) => m.name === name);
        if (!alreadyRegistered) {
          const newMember: TeamMember = {
            agentId,
            name,
            agentType: config.agentDefinition.agentType,
            joinedAt: Date.now(),
            cwd: config.context.workingDirectory,
            color: color ?? "white",
            isActive: true,
          };
          teamFile.members.push(newMember);
          writeTeamFileSync(teamName, teamFile);
        }
      }
    } catch {
      // Non-critical: team.json update failure should not block teammate spawn
    }

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
