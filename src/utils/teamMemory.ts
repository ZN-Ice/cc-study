import { join } from "node:path";
import { homedir } from "node:os";

function getTeamMemDir(teamName: string): string {
  const sanitized = teamName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  return join(homedir(), ".claude", "teams", sanitized, "memory");
}

export function isTeamMemFile(filePath: string): boolean {
  const teamsDir = join(homedir(), ".claude", "teams");
  return filePath.startsWith(teamsDir);
}

export function isTeamMemorySearch(toolInput: unknown): boolean {
  const input = toolInput as
    | { path?: string; pattern?: string; glob?: string }
    | undefined;
  if (!input) return false;
  if (input.path && isTeamMemFile(input.path)) return true;
  return false;
}

export function isTeamMemoryWriteOrEdit(
  toolName: string,
  toolInput: unknown,
): boolean {
  if (toolName !== "Write" && toolName !== "Edit") return false;
  const input = toolInput as { file_path?: string; path?: string } | undefined;
  const filePath = input?.file_path ?? input?.path;
  return filePath !== undefined && isTeamMemFile(filePath);
}

export function appendTeamMemorySummaryParts(
  memoryCounts: {
    teamMemoryReadCount?: number;
    teamMemorySearchCount?: number;
    teamMemoryWriteCount?: number;
  },
  parts: string[],
): void {
  if (memoryCounts.teamMemoryReadCount) {
    parts.push(
      `recalled ${memoryCounts.teamMemoryReadCount} team ${memoryCounts.teamMemoryReadCount === 1 ? "memory" : "memories"}`,
    );
  }
  if (memoryCounts.teamMemorySearchCount) {
    parts.push("searched team memories");
  }
  if (memoryCounts.teamMemoryWriteCount) {
    parts.push("wrote team memories");
  }
}

export function getTeamMemoryPath(teamName: string): string {
  return getTeamMemDir(teamName);
}
