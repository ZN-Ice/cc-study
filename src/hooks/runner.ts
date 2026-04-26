/**
 * Hook execution runner.
 *
 * Runs PreToolUse, PostToolUse, and Stop hooks in order.
 * PreToolUse hooks short-circuit on first false return.
 * PostToolUse and Stop hooks run to completion regardless of errors.
 */

import type { ToolResult } from "../tools/types.js";
import type {
  HookConfig,
  PreToolUseHook,
  PostToolUseHook,
  StopHook,
} from "./types.js";

export class HookRunner {
  private readonly preToolUseHooks: PreToolUseHook[];
  private readonly postToolUseHooks: PostToolUseHook[];
  private readonly stopHooks: StopHook[];

  constructor(config: HookConfig) {
    this.preToolUseHooks = config.preToolUse ?? [];
    this.postToolUseHooks = config.postToolUse ?? [];
    this.stopHooks = config.stop ?? [];
  }

  /**
   * Run all PreToolUse hooks.
   * Returns true if all hooks return true (or there are no hooks).
   * Short-circuits on first false return.
   */
  async runPreToolUseHooks(
    toolName: string,
    input: unknown,
  ): Promise<boolean> {
    for (const hook of this.preToolUseHooks) {
      if (hook.enabled === false) {
        continue;
      }

      const result = await Promise.resolve(
        hook.beforeToolUse(toolName, input),
      );

      if (result === false) {
        return false;
      }
    }

    return true;
  }

  /**
   * Run all PostToolUse hooks.
   * Errors are caught and logged but do not throw.
   */
  async runPostToolUseHooks(
    toolName: string,
    input: unknown,
    result: ToolResult,
  ): Promise<void> {
    for (const hook of this.postToolUseHooks) {
      if (hook.enabled === false) {
        continue;
      }

      try {
        await Promise.resolve(hook.afterToolUse(toolName, input, result));
      } catch (error) {
        // Log but don't throw - post hooks should not interrupt flow
        console.error(`PostToolUse hook "${hook.name}" failed:`, error);
      }
    }
  }

  /**
   * Run all Stop hooks.
   * Errors are caught and logged but do not throw.
   */
  async runStopHooks(): Promise<void> {
    for (const hook of this.stopHooks) {
      if (hook.enabled === false) {
        continue;
      }

      try {
        await Promise.resolve(hook.onStop());
      } catch (error) {
        // Log but don't throw - stop hooks should not interrupt shutdown
        console.error(`Stop hook "${hook.name}" failed:`, error);
      }
    }
  }
}
