/**
 * Team file helpers for reading/writing team state on disk.
 *
 * Each team is stored as a JSON file under ~/.claude/teams/<sanitized-name>/team.json.
 * Provides sync read (for quick lookups) and async write, plus sanitization
 * and unique-name generation utilities.
 */

import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface TeamMember {
  agentId: string;
  name: string;
  agentType?: string;
  model?: string;
  color?: string;
  joinedAt: number;
  cwd: string;
  isActive?: boolean;
}

export interface TeamFile {
  name: string;
  description?: string;
  createdAt: number;
  leadAgentId: string;
  leadSessionId?: string;
  members: TeamMember[];
}

// ──────────────────────────────────────────────
// Path utilities
// ──────────────────────────────────────────────

/**
 * Root directory for all team data.
 * Uses ~/.claude/teams/ by default.
 */
function getTeamsRoot(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return join(home, ".claude", "teams");
}

/**
 * Sanitize a team name for use as a filesystem path component.
 * Lowercases and replaces non-alphanumeric characters with hyphens.
 */
export function sanitizeName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

/**
 * Get the directory path for a given team name.
 */
export function getTeamDir(teamName: string): string {
  return join(getTeamsRoot(), sanitizeName(teamName));
}

/**
 * Get the team.json file path for a given team name.
 */
export function getTeamFilePath(teamName: string): string {
  return join(getTeamDir(teamName), "team.json");
}

// ──────────────────────────────────────────────
// Read / Write
// ──────────────────────────────────────────────

/**
 * Synchronously read a team file.
 * Returns null if the file doesn't exist or is invalid JSON.
 */
export function readTeamFile(teamName: string): TeamFile | null {
  const filePath = getTeamFilePath(teamName);
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as TeamFile;
  } catch {
    return null;
  }
}

/**
 * Synchronously write a team file to disk.
 * Creates parent directories as needed.
 */
export function writeTeamFileSync(
  teamName: string,
  teamFile: TeamFile,
): void {
  const dir = getTeamDir(teamName);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "team.json");
  writeFileSync(filePath, JSON.stringify(teamFile, null, 2), "utf-8");
}

/**
 * Asynchronously write a team file to disk.
 * Creates parent directories as needed.
 */
export async function writeTeamFileAsync(
  teamName: string,
  teamFile: TeamFile,
): Promise<void> {
  const dir = getTeamDir(teamName);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "team.json");
  await writeFile(filePath, JSON.stringify(teamFile, null, 2), "utf-8");
}

// ──────────────────────────────────────────────
// Name generation
// ──────────────────────────────────────────────

/**
 * Generate a unique team name by appending a short UUID suffix
 * when the base name already exists on disk.
 *
 * If the sanitized base name has no existing team file, it is returned as-is.
 */
export function generateUniqueTeamName(baseName: string): string {
  const sanitized = sanitizeName(baseName);
  if (!readTeamFile(sanitized)) {
    return sanitized;
  }

  const suffix = randomUUID().slice(0, 8);
  const candidate = `${sanitized}-${suffix}`;
  if (!readTeamFile(candidate)) {
    return candidate;
  }
  return generateUniqueTeamName(`${baseName}-${suffix}`);
}

/**
 * Generate an agent ID in the format "name@team".
 */
export function generateAgentId(name: string, teamName: string): string {
  return `${sanitizeName(name)}@${sanitizeName(teamName)}`;
}
