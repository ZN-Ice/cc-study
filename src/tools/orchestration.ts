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
  /** Which tool produced this result */
  readonly tool_name?: string;
  /** Original tool input for display */
  readonly tool_input?: Record<string, unknown>;
  /** Tool-specific metadata for rich rendering */
  readonly metadata?: Record<string, unknown>;
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
      tool_name: toolUse.name,
      tool_input: toolUse.input,
      metadata: result.metadata,
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
 * - Safe batches (consecutive read-only tools) execute in parallel within the batch
 * - Agent batches (sub-agents) execute concurrently with each other
 * - Other unsafe batches execute serially
 * Result order matches tool_use order for deterministic output.
 */
export async function executeAllToolBatches(
  toolUseBlocks: ToolUseBlock[],
  registry: ToolRegistry,
  context: ToolContext,
  permissionManager?: PermissionManager,
  onPermissionAsk?: OnPermissionAsk,
): Promise<Array<{ tool_use_id: string; content: string; is_error?: boolean; tool_name?: string; tool_input?: Record<string, unknown>; metadata?: Record<string, unknown> }>> {
  const batches = partitionToolCalls(toolUseBlocks, registry);
  const allResults: Array<{ tool_use_id: string; content: string; is_error?: boolean; tool_name?: string; tool_input?: Record<string, unknown>; metadata?: Record<string, unknown> }> = [];

  // Collect Agent batches separately — they'll run concurrently
  const agentBatches: ToolBatch[] = [];
  // Non-agent batches: safe + other unsafe, executed in order
  const otherBatches: ToolBatch[] = [];

  for (const batch of batches) {
    if (batch.blocks.some((b) => b.name === "Agent")) {
      agentBatches.push(batch);
    } else {
      otherBatches.push(batch);
    }
  }

  // Step 1: execute other batches in order (safe batches may run concurrently within)
  for (const batch of otherBatches) {
    if (context.abortSignal.aborted) break;

    const results = await executeToolBatch(
      batch, registry, context, permissionManager, onPermissionAsk,
    );

    for (const r of results) {
      allResults.push({
        tool_use_id: r.tool_use_id,
        content: r.output,
        is_error: r.error,
        tool_name: r.tool_name,
        tool_input: r.tool_input,
        metadata: r.metadata,
      });
    }
  }

  // Step 2: execute all agent batches concurrently
  if (agentBatches.length > 0 && !context.abortSignal.aborted) {
    if (agentBatches.length === 1) {
      // Single agent — no concurrency benefit, just execute normally
      const results = await executeToolBatch(
        agentBatches[0]!, registry, context, permissionManager, onPermissionAsk,
      );
      for (const r of results) {
        allResults.push({
          tool_use_id: r.tool_use_id,
          content: r.output,
          is_error: r.error,
          tool_name: r.tool_name,
          tool_input: r.tool_input,
          metadata: r.metadata,
        });
      }
    } else {
      // Multiple agents — run concurrently
      const agentResults = await Promise.all(
        agentBatches.map((batch) =>
          executeToolBatch(batch, registry, context, permissionManager, onPermissionAsk),
        ),
      );

      // Collect results in batch order (each batch's results are already in tool order)
      for (const results of agentResults) {
        for (const r of results) {
          allResults.push({
            tool_use_id: r.tool_use_id,
            content: r.output,
            is_error: r.error,
            tool_name: r.tool_name,
            tool_input: r.tool_input,
            metadata: r.metadata,
          });
        }
      }
    }
  }

  return allResults;
}
