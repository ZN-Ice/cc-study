/**
 * Teammate utilities for agent swarm coordination.
 *
 * References: free-code/src/utils/teammate.ts
 *
 * These helpers identify whether this cc-study instance is running as a
 * spawned teammate in a swarm. Teammates receive their identity through
 * dynamicTeamContext (set by TeamCreateTool or spawn).
 *
 * Priority order for identity resolution:
 * 1. AsyncLocalStorage (in-process teammates) - via teammateContext.ts
 * 2. dynamicTeamContext (module-level state in this file)
 */

import {
  getTeammateContext,
  isInProcessTeammate,
} from "./teammateContext.js";

// ──────────────────────────────────────────────
// Dynamic Team Context
// ──────────────────────────────────────────────

/**
 * Dynamic team context for runtime team joining.
 * When set, these values take precedence over environment variables.
 */
let dynamicTeamContext: {
  agentId: string;
  agentName: string;
  teamName: string;
  color?: string;
  planModeRequired: boolean;
  parentSessionId?: string;
} | null = null;

/**
 * Set the dynamic team context (called when joining a team at runtime).
 */
export function setDynamicTeamContext(
  context: {
    agentId: string;
    agentName: string;
    teamName: string;
    color?: string;
    planModeRequired: boolean;
    parentSessionId?: string;
  } | null,
): void {
  dynamicTeamContext = context;
}

/**
 * Clear the dynamic team context (called when leaving a team).
 */
export function clearDynamicTeamContext(): void {
  dynamicTeamContext = null;
}

/**
 * Get the current dynamic team context (for inspection/debugging).
 */
export function getDynamicTeamContext(): typeof dynamicTeamContext {
  return dynamicTeamContext;
}

// ──────────────────────────────────────────────
// Identity Resolution
// ──────────────────────────────────────────────

/**
 * Returns the agent ID if this session is running as a teammate in a swarm,
 * or undefined if running as a standalone session.
 * Priority: AsyncLocalStorage (in-process) > dynamicTeamContext.
 */
export function getAgentId(): string | undefined {
  const inProcessCtx = getTeammateContext();
  if (inProcessCtx) return inProcessCtx.agentId;
  return dynamicTeamContext?.agentId;
}

/**
 * Returns the agent name if this session is running as a teammate in a swarm.
 * Priority: AsyncLocalStorage (in-process) > dynamicTeamContext.
 */
export function getAgentName(): string | undefined {
  const inProcessCtx = getTeammateContext();
  if (inProcessCtx) return inProcessCtx.agentName;
  return dynamicTeamContext?.agentName;
}

/**
 * Returns the team name if this session is part of a team.
 * Priority: AsyncLocalStorage (in-process) > dynamicTeamContext.
 *
 * @param teamContext - Optional team context (for leaders)
 */
export function getTeamName(teamContext?: {
  teamName: string;
}): string | undefined {
  const inProcessCtx = getTeammateContext();
  if (inProcessCtx) return inProcessCtx.teamName;
  if (dynamicTeamContext?.teamName) return dynamicTeamContext.teamName;
  return teamContext?.teamName;
}

/**
 * Returns the parent session ID for this teammate.
 * Priority: AsyncLocalStorage (in-process) > dynamicTeamContext.
 */
export function getParentSessionId(): string | undefined {
  const inProcessCtx = getTeammateContext();
  if (inProcessCtx) return inProcessCtx.parentSessionId;
  return dynamicTeamContext?.parentSessionId;
}

/**
 * Returns the teammate's assigned color,
 * or undefined if not running as a teammate or no color assigned.
 * Priority: AsyncLocalStorage (in-process) > dynamicTeamContext.
 */
export function getTeammateColor(): string | undefined {
  const inProcessCtx = getTeammateContext();
  if (inProcessCtx) return inProcessCtx.color;
  return dynamicTeamContext?.color;
}

// ──────────────────────────────────────────────
// Identity Checks
// ──────────────────────────────────────────────

/**
 * Returns true if this session is running as a teammate in a swarm.
 * Priority: AsyncLocalStorage (in-process) > dynamicTeamContext.
 */
export function isTeammate(): boolean {
  // In-process teammates run within the same process
  if (isInProcessTeammate()) return true;
  // Dynamic team context requires both agent ID and team name
  return !!(dynamicTeamContext?.agentId && dynamicTeamContext?.teamName);
}

/**
 * Check if this session is a team lead.
 *
 * A session is considered a team lead if:
 * 1. A team context exists with a leadAgentId, AND
 * 2. Either:
 *    - Our agent ID matches the leadAgentId, OR
 *    - We have no agent ID set (backwards compat: the original
 *      session that created the team)
 *
 * @param teamContext - The team context with leadAgentId
 * @returns true if this session is the team lead
 */
export function isTeamLead(
  teamContext: { leadAgentId: string } | undefined,
): boolean {
  if (!teamContext?.leadAgentId) {
    return false;
  }

  const myAgentId = getAgentId();
  const leadAgentId = teamContext.leadAgentId;

  // If my agent ID matches the lead agent ID, I'm the lead
  if (myAgentId === leadAgentId) {
    return true;
  }

  // Backwards compat: if no agent ID is set and we have a team context,
  // this is the original session that created the team (the lead)
  if (!myAgentId) {
    return true;
  }

  return false;
}

/**
 * Returns true if this teammate session requires plan mode before implementation.
 * Priority: AsyncLocalStorage > dynamicTeamContext.
 */
export function isPlanModeRequired(): boolean {
  const inProcessCtx = getTeammateContext();
  if (inProcessCtx) return inProcessCtx.planModeRequired;
  if (dynamicTeamContext !== null) {
    return dynamicTeamContext.planModeRequired;
  }
  return false;
}

// ──────────────────────────────────────────────
// Re-exports
// ──────────────────────────────────────────────

export {
  getTeammateContext,
  isInProcessTeammate,
  runWithTeammateContext,
  createTeammateContext,
  type TeammateContext,
} from "./teammateContext.js";
