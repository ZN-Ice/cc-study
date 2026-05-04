import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readTeamFile } from "./teamHelper.js";

function getTeamsDir(): string {
  return join(homedir(), ".claude", "teams");
}

export interface TeammateStatus {
  name: string;
  agentId: string;
  agentType?: string;
  model?: string;
  status: "running" | "idle" | "unknown";
  color?: string;
  cwd: string;
}

export interface TeamSummary {
  name: string;
  memberCount: number;
  runningCount: number;
  idleCount: number;
}

export function discoverTeams(): string[] {
  const teamsDir = getTeamsDir();
  if (!existsSync(teamsDir)) return [];
  try {
    return readdirSync(teamsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

export function getTeammateStatuses(teamName: string): TeammateStatus[] {
  const teamFile = readTeamFile(teamName);
  if (!teamFile) return [];

  return teamFile.members
    .filter((m) => m.name !== "team-lead")
    .map((m) => ({
      name: m.name,
      agentId: m.agentId,
      agentType: m.agentType,
      model: m.model,
      status: (m.isActive !== false ? "running" : "idle") as TeammateStatus["status"],
      color: m.color,
      cwd: m.cwd,
    }));
}

export function getTeamSummary(teamName: string): TeamSummary | null {
  const statuses = getTeammateStatuses(teamName);
  if (statuses.length === 0 && !readTeamFile(teamName)) return null;

  return {
    name: teamName,
    memberCount: statuses.length,
    runningCount: statuses.filter((s) => s.status === "running").length,
    idleCount: statuses.filter((s) => s.status === "idle").length,
  };
}
