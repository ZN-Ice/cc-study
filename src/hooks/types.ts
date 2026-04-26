/**
 * Hook system type definitions.
 *
 * References: free-code/src/hooks/
 *
 * Three hook types:
 * - PreToolUse: runs before tool execution, can allow or block
 * - PostToolUse: runs after tool execution, for logging/metrics
 * - Stop: runs when the agent receives a stop signal
 */

import type { ToolResult } from "../tools/types.js";

// ──────────────────────────────────────────────
// Hook Types
// ──────────────────────────────────────────────

export type HookType = "PreToolUse" | "PostToolUse" | "Stop";

export interface Hook {
  type: HookType;
  name: string;
  /** Whether the hook is active (default: true) */
  enabled?: boolean;
}

export interface PreToolUseHook extends Hook {
  type: "PreToolUse";
  /**
   * Called before tool execution.
   * Return true to proceed with execution, false to block.
   */
  beforeToolUse(toolName: string, input: unknown): boolean | Promise<boolean>;
}

export interface PostToolUseHook extends Hook {
  type: "PostToolUse";
  /**
   * Called after tool execution.
   * Use for logging, metrics, or modifying the result.
   */
  afterToolUse(
    toolName: string,
    input: unknown,
    result: ToolResult,
  ): void | Promise<void>;
}

export interface StopHook extends Hook {
  type: "Stop";
  /**
   * Called when the agent receives a stop signal.
   * Use for cleanup, state persistence, or graceful shutdown.
   */
  onStop(): void | Promise<void>;
}

export type AnyHook = PreToolUseHook | PostToolUseHook | StopHook;

// ──────────────────────────────────────────────
// Hook Config
// ──────────────────────────────────────────────

export interface HookConfig {
  preToolUse?: PreToolUseHook[];
  postToolUse?: PostToolUseHook[];
  stop?: StopHook[];
}
