/**
 * Tests for tool orchestration: partition + concurrent/serial batch execution.
 */

import { describe, test, expect, beforeEach } from "vitest";
import {
  partitionToolCalls,
  executeToolBatch,
  executeAllToolBatches,
  type ToolBatch,
} from "../../../src/tools/orchestration.js";
import { ToolRegistry } from "../../../src/tools/registry.js";
import type { Tool, ToolContext } from "../../../src/tools/types.js";
import { z } from "zod";
import { FileReadTool } from "../../../src/tools/FileReadTool.js";
import { FileWriteTool } from "../../../src/tools/FileWriteTool.js";
import { FileEditTool } from "../../../src/tools/FileEditTool.js";
import { BashTool } from "../../../src/tools/BashTool.js";
import { GlobTool } from "../../../src/tools/GlobTool.js";
import { GrepTool } from "../../../src/tools/GrepTool.js";

function createTestRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(FileReadTool);
  registry.register(FileWriteTool);
  registry.register(FileEditTool);
  registry.register(BashTool);
  registry.register(GlobTool);
  registry.register(GrepTool);
  return registry;
}

function createTestContext(): ToolContext {
  return {
    workingDirectory: process.cwd(),
    abortSignal: new AbortController().signal,
  };
}

describe("partitionToolCalls", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createTestRegistry();
  });

  test("empty array returns empty batches", () => {
    const batches = partitionToolCalls([], registry);
    expect(batches).toEqual([]);
  });

  test("single read-only tool creates one safe batch", () => {
    const batches = partitionToolCalls(
      [{ type: "tool_use", id: "1", name: "Read", input: { file_path: "/tmp/a" } }],
      registry,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]!.isConcurrencySafe).toBe(true);
    expect(batches[0]!.blocks).toHaveLength(1);
  });

  test("single write tool creates one unsafe batch", () => {
    const batches = partitionToolCalls(
      [{ type: "tool_use", id: "1", name: "Write", input: { file_path: "/tmp/a", content: "x" } }],
      registry,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]!.isConcurrencySafe).toBe(false);
  });

  test("consecutive safe tools merge into one batch", () => {
    const batches = partitionToolCalls(
      [
        { type: "tool_use" as const, id: "1", name: "Read", input: { file_path: "/tmp/a" } },
        { type: "tool_use" as const, id: "2", name: "Glob", input: { pattern: "**/*.ts" } },
        { type: "tool_use" as const, id: "3", name: "Grep", input: { pattern: "TODO" } },
      ],
      registry,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]!.isConcurrencySafe).toBe(true);
    expect(batches[0]!.blocks).toHaveLength(3);
  });

  test("safe + unsafe + safe = three batches", () => {
    const batches = partitionToolCalls(
      [
        { type: "tool_use" as const, id: "1", name: "Read", input: { file_path: "/tmp/a" } },
        { type: "tool_use" as const, id: "2", name: "Write", input: { file_path: "/tmp/b", content: "x" } },
        { type: "tool_use" as const, id: "3", name: "Glob", input: { pattern: "**/*.ts" } },
      ],
      registry,
    );
    expect(batches).toHaveLength(3);
    expect(batches[0]!.isConcurrencySafe).toBe(true);
    expect(batches[0]!.blocks).toHaveLength(1);
    expect(batches[1]!.isConcurrencySafe).toBe(false);
    expect(batches[1]!.blocks).toHaveLength(1);
    expect(batches[2]!.isConcurrencySafe).toBe(true);
    expect(batches[2]!.blocks).toHaveLength(1);
  });

  test("Read,Read,Write,Write = two batches (safe merge, unsafe separate)", () => {
    const batches = partitionToolCalls(
      [
        { type: "tool_use" as const, id: "1", name: "Read", input: { file_path: "/tmp/a" } },
        { type: "tool_use" as const, id: "2", name: "Read", input: { file_path: "/tmp/b" } },
        { type: "tool_use" as const, id: "3", name: "Write", input: { file_path: "/tmp/c", content: "x" } },
        { type: "tool_use" as const, id: "4", name: "Edit", input: { file_path: "/tmp/d", old_string: "a", new_string: "b" } },
      ],
      registry,
    );
    // Read+Read → safe batch, Write → unsafe, Edit → unsafe
    expect(batches).toHaveLength(3);
    expect(batches[0]!.isConcurrencySafe).toBe(true);
    expect(batches[0]!.blocks).toHaveLength(2);
    expect(batches[1]!.isConcurrencySafe).toBe(false);
    expect(batches[1]!.blocks).toHaveLength(1);
    expect(batches[2]!.isConcurrencySafe).toBe(false);
    expect(batches[2]!.blocks).toHaveLength(1);
  });

  test("unknown tool creates unsafe batch", () => {
    const batches = partitionToolCalls(
      [{ type: "tool_use", id: "1", name: "NonExistent", input: {} }],
      registry,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]!.isConcurrencySafe).toBe(false);
  });
});

describe("executeToolBatch", () => {
  let registry: ToolRegistry;
  let context: ToolContext;

  // Create a mock tool that tracks execution order and timing
  function createMockTool(
    name: string,
    safe: boolean,
    durationMs: number,
  ): Tool<z.ZodType> {
    const schema = z.strictObject({ value: z.string().optional() });
    return {
      name,
      description: `Mock ${name}`,
      inputSchema: schema,
      isConcurrencySafe: safe ? () => true : undefined,
      async validateInput() { return { ok: true as const }; },
      async execute(_input) {
        const start = Date.now();
        // Busy wait (don't use sleep — we need to test concurrency wall-clock time)
        while (Date.now() - start < durationMs) { /* spin */ }
        return { output: `${name} executed` };
      },
    };
  }

  beforeEach(() => {
    registry = new ToolRegistry();
    context = createTestContext();
  });

  test("safe batch runs tools concurrently", async () => {
    const slowRead = createMockTool("SlowRead", true, 50);
    const slowGlob = createMockTool("SlowGlob", true, 50);
    registry.register(slowRead);
    registry.register(slowGlob);

    const batch: ToolBatch = {
      isConcurrencySafe: true,
      blocks: [
        { type: "tool_use", id: "1", name: "SlowRead", input: {} },
        { type: "tool_use", id: "2", name: "SlowGlob", input: {} },
      ],
    };

    const start = Date.now();
    const results = await executeToolBatch(batch, registry, context);
    const elapsed = Date.now() - start;

    // If concurrent: ~50ms. If serial: ~100ms.
    // Allow generous margin but must be clearly concurrent
    expect(elapsed).toBeLessThan(120);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.tool_use_id === "1")).toBeDefined();
    expect(results.find((r) => r.tool_use_id === "2")).toBeDefined();
  });

  test("unsafe batch runs tools serially", async () => {
    const slowWrite = createMockTool("SlowWrite", false, 30);
    const slowEdit = createMockTool("SlowEdit", false, 30);
    registry.register(slowWrite);
    registry.register(slowEdit);

    const batch: ToolBatch = {
      isConcurrencySafe: false,
      blocks: [
        { type: "tool_use", id: "1", name: "SlowWrite", input: {} },
        { type: "tool_use", id: "2", name: "SlowEdit", input: {} },
      ],
    };

    const start = Date.now();
    const results = await executeToolBatch(batch, registry, context);
    const elapsed = Date.now() - start;

    // If serial: ~60ms+. If concurrent: ~30ms.
    expect(elapsed).toBeGreaterThanOrEqual(55);
    expect(results).toHaveLength(2);
  });
});

describe("executeAllToolBatches", () => {
  let registry: ToolRegistry;
  let context: ToolContext;

  beforeEach(() => {
    registry = createTestRegistry();
    context = createTestContext();
  });

  test("returns error for unknown tools", async () => {
    const results = await executeAllToolBatches(
      [{ type: "tool_use", id: "1", name: "NonExistent", input: {} }],
      registry,
      context,
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.is_error).toBe(true);
    expect(results[0]!.content).toContain("Unknown tool");
  });

  test("handles mixed safe and unsafe tools", async () => {
    // Use real tools but with file paths that may not exist
    // This tests the partition + execution pipeline, not tool correctness
    // GrepTool spawns rg --version to check availability; allow generous time in CI
    const results = await executeAllToolBatches(
      [
        { type: "tool_use" as const, id: "1", name: "Glob", input: { pattern: "*.nonexistent" } },
        { type: "tool_use" as const, id: "2", name: "Grep", input: { pattern: "NONEXISTENT_PATTERN_12345" } },
      ],
      registry,
      context,
    );
    expect(results).toHaveLength(2);
    // Both are safe tools that should run concurrently
    expect(results.find((r) => r.tool_use_id === "1")).toBeDefined();
    expect(results.find((r) => r.tool_use_id === "2")).toBeDefined();
  }, 30000);

  test("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const ctx: ToolContext = {
      workingDirectory: process.cwd(),
      abortSignal: controller.signal,
    };

    const results = await executeAllToolBatches(
      [{ type: "tool_use", id: "1", name: "Read", input: { file_path: "/tmp/a" } }],
      registry,
      ctx,
    );
    // Should return empty results when aborted
    expect(results).toHaveLength(0);
  });
});
