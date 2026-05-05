/**
 * Progress-based heartbeat for teammate agents.
 *
 * Unlike a timer-based heartbeat (which fires even when the teammate is hung),
 * this tracks the LAST MEANINGFUL PROGRESS — updated each time the teammate
 * executes a tool or makes an API call. If no progress is reported for
 * HEARTBEAT_TIMEOUT_MS, the teammate is considered stale (likely hung on
 * a blocking call or crashed).
 *
 * Design: progress state lives in process memory (not mailbox files).
 */

import { createDebug } from "../debug.js";

const debug = createDebug("agent:heartbeat");

/** After this many ms without progress, the teammate is considered stale (60 seconds). */
export const HEARTBEAT_TIMEOUT_MS = 60_000;

// ──────────────────────────────────────────────
// Progress state (process-wide, in-memory)
// ──────────────────────────────────────────────

export interface HeartbeatState {
  agentId: string;
  agentName: string;
  lastProgressMs: number;
  startedAt: number;
}

const heartbeatStates = new Map<string, HeartbeatState>();

// ──────────────────────────────────────────────
// Start / Stop / Update
// ──────────────────────────────────────────────

/**
 * Register a teammate for progress tracking.
 * Call this when the teammate starts running.
 */
export function startHeartbeat(agentId: string, agentName: string): void {
  const now = Date.now();
  heartbeatStates.set(agentId, {
    agentId,
    agentName,
    lastProgressMs: now,
    startedAt: now,
  });
  debug("heartbeat registered: %s", agentId);
}

/**
 * Unregister a teammate and clean up state.
 * Call this when the teammate completes or fails.
 */
export function stopHeartbeat(agentId: string): void {
  heartbeatStates.delete(agentId);
  debug("heartbeat unregistered: %s", agentId);
}

/**
 * Update the last progress timestamp for a teammate.
 * Call this each time the teammate executes a tool or makes meaningful progress.
 */
export function updateHeartbeat(agentId: string): void {
  const state = heartbeatStates.get(agentId);
  if (state) {
    state.lastProgressMs = Date.now();
    debug("heartbeat update: %s (lastProgress=%d)", agentId, state.lastProgressMs);
  }
}

// ──────────────────────────────────────────────
// Query (for leader polling)
// ──────────────────────────────────────────────

/**
 * Get heartbeat states for all running teammates.
 */
export function getHeartbeatStates(): HeartbeatState[] {
  return [...heartbeatStates.values()];
}

export interface StaleTeammate {
  agentId: string;
  agentName: string;
  staleMs: number;
}

/**
 * Detect teammates whose progress has timed out.
 * Returns an array of stale teammates with how long they've been silent.
 */
export function detectStaleTeammates(): StaleTeammate[] {
  const now = Date.now();
  const stale: StaleTeammate[] = [];

  for (const state of heartbeatStates.values()) {
    const elapsed = now - state.lastProgressMs;
    if (elapsed > HEARTBEAT_TIMEOUT_MS) {
      stale.push({
        agentId: state.agentId,
        agentName: state.agentName,
        staleMs: elapsed,
      });
    }
  }

  return stale;
}

/**
 * Check if a specific teammate is stale.
 */
export function isTeammateStale(agentId: string): boolean {
  const state = heartbeatStates.get(agentId);
  if (!state) return false; // not tracked = not stale (already completed)
  return (Date.now() - state.lastProgressMs) > HEARTBEAT_TIMEOUT_MS;
}
