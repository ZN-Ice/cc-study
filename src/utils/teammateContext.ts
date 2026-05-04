/**
 * TeammateContext - Runtime context for in-process teammates.
 *
 * References: free-code/src/utils/teammateContext.ts
 *
 * Provides AsyncLocalStorage-based context for in-process teammates,
 * enabling concurrent teammate execution without global state conflicts.
 *
 * Priority order for identity resolution:
 * 1. AsyncLocalStorage (in-process teammates) - this module
 * 2. dynamicTeamContext (teammate.ts)
 * 3. Environment variables
 *
 * Simplify: If AsyncLocalStorage is unavailable (e.g., test environment),
 * fall back to module-level variable (single-process only).
 */

let AsyncLocalStorage: typeof import("async_hooks").AsyncLocalStorage | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const asyncHooks = await import("node:async_hooks");
  AsyncLocalStorage = asyncHooks.AsyncLocalStorage;
} catch {
  // Fallback: module-level variable for environments without async_hooks
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

/**
 * Runtime context for in-process teammates.
 * Stored in AsyncLocalStorage for concurrent access.
 */
export interface TeammateContext {
  /** Full agent ID, e.g., "researcher@my-team" */
  readonly agentId: string;
  /** Display name, e.g., "researcher" */
  readonly agentName: string;
  /** Team name this teammate belongs to */
  readonly teamName: string;
  /** UI color assigned to this teammate */
  readonly color?: string;
  /** Whether teammate must enter plan mode before implementing */
  readonly planModeRequired: boolean;
  /** Leader's session ID (for transcript correlation) */
  readonly parentSessionId: string;
  /** Discriminator - always true for in-process teammates */
  readonly isInProcess: true;
  /** Abort controller for lifecycle management */
  readonly abortController: AbortController;
}

// ──────────────────────────────────────────────
// Storage (AsyncLocalStorage or fallback)
// ──────────────────────────────────────────────

// Module-level fallback for environments without async_hooks
let fallbackContext: TeammateContext | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const storage = AsyncLocalStorage ? new AsyncLocalStorage<TeammateContext>() : null;

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * Get the current in-process teammate context, if running as one.
 * Returns undefined if not running within an in-process teammate context.
 */
export function getTeammateContext(): TeammateContext | undefined {
  if (storage) {
    return storage.getStore();
  }
  return fallbackContext;
}

/**
 * Run a function with teammate context set.
 * Used when spawning an in-process teammate to establish its execution context.
 *
 * @param context - The teammate context to set
 * @param fn - The function to run with the context
 * @returns The return value of fn
 */
export function runWithTeammateContext<T>(
  context: TeammateContext,
  fn: () => T,
): T {
  if (storage) {
    return storage.run(context, fn);
  }
  // Fallback: set module-level variable
  const prev = fallbackContext;
  fallbackContext = context;
  try {
    return fn();
  } finally {
    fallbackContext = prev;
  }
}

/**
 * Check if current execution is within an in-process teammate.
 * This is faster than getTeammateContext() !== undefined for simple checks.
 */
export function isInProcessTeammate(): boolean {
  return getTeammateContext() !== undefined;
}

/**
 * Create a TeammateContext from spawn configuration.
 *
 * @param config - Configuration for the teammate context
 * @returns A complete TeammateContext with isInProcess: true
 */
export function createTeammateContext(config: {
  agentId: string;
  agentName: string;
  teamName: string;
  color?: string;
  planModeRequired: boolean;
  parentSessionId: string;
  abortController: AbortController;
}): TeammateContext {
  return {
    ...config,
    isInProcess: true,
  };
}
