/**
 * Tool orchestration — partition tool calls into concurrent/serial batches.
 *
 * References: free-code/src/services/tools/toolOrchestration.ts
 *
 * Strategy:
 * 1. Partition tool_use blocks into batches by isConcurrencySafe
 * 2. Consecutive concurrency-safe tools → merged into one batch → parallel execution
 * 3. Non-safe tools → each gets its own batch → serial execution (with permissions)
 */

import type { ToolUseBlock } from "../messages.js";
import type { Tool, ToolContext } from "./types.js";
import { ToolRegistry, executeTool, executeToolWithPermissions, type OnPermissionAsk } from "./registry.js";
import type { PermissionManager } from "../permissions/manager.js";

// ──────────────────────────────────────────────
// Batch Types
// ──────────────────────────────────────────────

export interface ToolBatch {
  /** Whether ALL tools in this batch are concurrency-safe */
  readonly isConcurrencySafe: boolean;
  /** Tool use blocks in this batch */
  readonly blocks: ToolUseBlock[];
}

// ──────────────────────────────────────────────
// Partition Algorithm
// ──────────────────────────────────────────────

/**
 * Partition tool_use blocks into batches where each batch is either:
 * 1. A single non-concurrency-safe tool, or
 * 2. Multiple consecutive concurrency-safe tools (merged into one batch)
 *
 * Example:
 *   [Read(A), Write(B), Read(C), Glob(D), Read(E)]
 *   → [{safe:true, [Read(A)]}, {safe:false, [Write(B)]}, {safe:true, [Read(C), Glob(D), Read(E)]}]
 */
export function partitionToolCalls(
  toolUseBlocks: ToolUseBlock[],
  registry: ToolRegistry,
): ToolBatch[] {
  return toolUseBlocks.reduce((acc: ToolBatch[], toolUse) => {
    const tool = registry.get(toolUse.name) as Tool | undefined;
    const isSafe = checkConcurrencySafe(tool, toolUse.input);

    // If this tool is safe AND the previous batch is also safe, merge
    if (isSafe && acc.length > 0 && acc[acc.length - 1]!.isConcurrencySafe) {
      acc[acc.length - 1]!.blocks.push(toolUse);
    } else {
      acc.push({ isConcurrencySafe: isSafe, blocks: [toolUse] });
    }
    return acc;
  }, []);
}

/**
 * Check if a tool invocation is concurrency-safe.
 * Conservative: if tool not found or isConcurrencySafe throws, returns false.
 */
function checkConcurrencySafe(
  tool: Tool | undefined,
  input: Record<string, unknown>,
): boolean {
  if (!tool) return false;
  try {
    return Boolean(tool.isConcurrencySafe?.(input));
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────
// Batch Execution
// ──────────────────────────────────────────────

export interface ToolExecutionResult {
  readonly tool_use_id: string;
  readonly output: string;
  readonly error?: boolean;
}

/**
 * Execute a batch of tool calls.
 * - Concurrency-safe batches run in parallel
 * - Non-safe batches run serially
 */
export async function executeToolBatch(
  batch: ToolBatch,
  registry: ToolRegistry,
  context: ToolContext,
  permissionManager?: PermissionManager,
  onPermissionAsk?: OnPermissionAsk,
): Promise<ToolExecutionResult[]> {
  if (batch.isConcurrencySafe) {
    return executeToolsConcurrently(batch.blocks, registry, context, permissionManager, onPermissionAsk);
  }
  return executeToolsSerially(batch.blocks, registry, context, permissionManager, onPermissionAsk);
}

const MAX_CONCURRENCY = 10;

/**
 * Execute tools in parallel (for concurrency-safe batches).
 * Uses a simple concurrency limiter.
 */
async function executeToolsConcurrently(
  blocks: ToolUseBlock[],
  registry: ToolRegistry,
  context: ToolContext,
  permissionManager?: PermissionManager,
  onPermissionAsk?: OnPermissionAsk,
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];
  const queue = [...blocks];

  // Run up to MAX_CONCURRENCY in parallel
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENCY, queue.length) },
    async (): Promise<void> => {
      while (queue.length > 0) {
        const toolUse = queue.shift();
        if (!toolUse) break;
        if (context.abortSignal.aborted) break;

        const result = await executeSingleTool(
          toolUse, registry, context, permissionManager, onPermissionAsk,
        );
        results.push(result);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

/**
 * Execute tools serially, one after another.
 */
async function executeToolsSerially(
  blocks: ToolUseBlock[],
  registry: ToolRegistry,
  context: ToolContext,
  permissionManager?: PermissionManager,
  onPermissionAsk?: OnPermissionAsk,
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];
  for (const toolUse of blocks) {
    if (context.abortSignal.aborted) break;

    const result = await executeSingleTool(
      toolUse, registry, context, permissionManager, onPermissionAsk,
    );
    results.push(result);
  }
  return results;
}

/**
 * Execute a single tool call with optional permission checking.
 */
async function executeSingleTool(
  toolUse: ToolUseBlock,
  registry: ToolRegistry,
  context: ToolContext,
  permissionManager?: PermissionManager,
  onPermissionAsk?: OnPermissionAsk,
): Promise<ToolExecutionResult> {
  try {
    const result = permissionManager
      ? await executeToolWithPermissions(
          registry, toolUse.name, toolUse.input, context,
          permissionManager, onPermissionAsk,
        )
      : await executeTool(registry, toolUse.name, toolUse.input, context);

    return {
      tool_use_id: toolUse.id,
      output: result.output,
      error: result.error,
    };
  } catch (err) {
    return {
      tool_use_id: toolUse.id,
      output: err instanceof Error ? err.message : String(err),
      error: true,
    };
  }
}

// ──────────────────────────────────────────────
// All Batches Execution (convenience)
// ──────────────────────────────────────────────

/**
 * Execute all tool_use blocks using the partition + batch strategy.
 * Returns tool_result blocks ready to be sent back to the API.
 */
export async function executeAllToolBatches(
  toolUseBlocks: ToolUseBlock[],
  registry: ToolRegistry,
  context: ToolContext,
  permissionManager?: PermissionManager,
  onPermissionAsk?: OnPermissionAsk,
): Promise<Array<{ tool_use_id: string; content: string; is_error?: boolean }>> {
  const batches = partitionToolCalls(toolUseBlocks, registry);
  const allResults: Array<{ tool_use_id: string; content: string; is_error?: boolean }> = [];

  for (const batch of batches) {
    if (context.abortSignal.aborted) break;

    const results = await executeToolBatch(
      batch, registry, context, permissionManager, onPermissionAsk,
    );

    for (const r of results) {
      allResults.push({
        tool_use_id: r.tool_use_id,
        content: r.output,
        is_error: r.error,
      });
    }
  }

  return allResults;
}
