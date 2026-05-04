import { z } from "zod";
import type { Tool, ToolResult, ToolContext, ValidationResult } from "../types.js";
import {
  sanitizeName,
  generateAgentId,
  generateUniqueTeamName,
  writeTeamFileAsync,
  readTeamFile,
  type TeamFile,
} from "../../utils/teamHelper.js";
import {
  setDynamicTeamContext,
} from "../../utils/teammate.js";
import { TEAM_LEAD_NAME } from "../../utils/teammateMailbox.js";

const teamCreateInputSchema = z.strictObject({
  team_name: z.string().describe("Name for the new team to create"),
  description: z.string().optional().describe("Team description/purpose"),
  agent_type: z.string().optional().describe(
    "Type/role of the team lead (default: 'team-lead')",
  ),
});

type TeamCreateInput = z.infer<typeof teamCreateInputSchema>;

const COLORS = ["cyan", "magenta", "green", "yellow", "blue", "red"];

function assignColor(index: number): string {
  return COLORS[index % COLORS.length];
}

export const TeamCreateTool: Tool<typeof teamCreateInputSchema> = {
  name: "team_create",
  description:
    "Create a new team for coordinating multiple agents in a swarm. " +
    "Creates a team file and registers the current session as the team lead.",

  inputSchema: teamCreateInputSchema,

  requiresConfirmation: true,

  async validateInput(
    input: TeamCreateInput,
    _context: ToolContext,
  ): Promise<ValidationResult> {
    if (!input.team_name || input.team_name.trim().length === 0) {
      return { ok: false, error: "Error: team_name is required" };
    }
    return { ok: true };
  },

  async checkPermissions() {
    return undefined;
  },

  isSearchOrReadCommand(): { isSearch: boolean; isRead: boolean } {
    return { isSearch: false, isRead: false };
  },

  async execute(
    input: TeamCreateInput,
    context: ToolContext,
  ): Promise<ToolResult> {
    const { team_name, description, agent_type } = input;

    // Check if already in a team
    const existingTeam = sanitizeName(team_name);
    if (readTeamFile(existingTeam)) {
      // Team exists - try generate unique name
      const uniqueName = generateUniqueTeamName(team_name);
      if (uniqueName !== existingTeam) {
        return this.execute(
          { ...input, team_name: uniqueName },
          context,
        );
      }
    }

    const finalTeamName = existingTeam;
    const leadAgentType = agent_type ?? TEAM_LEAD_NAME;
    const leadAgentId = generateAgentId(TEAM_LEAD_NAME, finalTeamName);

    const teamFile: TeamFile = {
      name: finalTeamName,
      description,
      createdAt: Date.now(),
      leadAgentId,
      members: [
        {
          agentId: leadAgentId,
          name: TEAM_LEAD_NAME,
          agentType: leadAgentType,
          joinedAt: Date.now(),
          cwd: context.workingDirectory,
          color: assignColor(0),
        },
      ],
    };

    try {
      await writeTeamFileAsync(finalTeamName, teamFile);

      // Set dynamic team context for this session
      setDynamicTeamContext({
        agentId: leadAgentId,
        agentName: TEAM_LEAD_NAME,
        teamName: finalTeamName,
        color: assignColor(0),
        planModeRequired: false,
      });

      return {
        output: JSON.stringify(
          {
            team_name: finalTeamName,
            team_file_path: `${finalTeamName}/team.json`,
            lead_agent_id: leadAgentId,
          },
          null,
          2,
        ),
        metadata: {
          teamName: finalTeamName,
          leadAgentId,
          memberCount: 1,
        },
      };
    } catch (err) {
      return {
        output: `Failed to create team: ${err instanceof Error ? err.message : String(err)}`,
        error: true,
      };
    }
  },
};
