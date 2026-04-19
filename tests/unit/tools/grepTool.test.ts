/**
 * Tests for GrepTool
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GrepTool } from "../../../src/tools/GrepTool.js";
import { ToolRegistry, executeTool } from "../../../src/tools/registry.js";
import type { ToolContext } from "../../../src/tools/types.js";

let tempDir: string;
const context: ToolContext = {
  workingDirectory: "",
  abortSignal: new AbortController().signal,
};

/** Run GrepTool through the full lifecycle */
async function runTool(input: Record<string, unknown>) {
  const registry = new ToolRegistry();
  registry.register(GrepTool);
  return executeTool(registry, "Grep", input, context);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cc-study-test-"));
  context.workingDirectory = tempDir;
  writeFileSync(join(tempDir, "a.txt"), "hello world\nfoo bar\nbaz qux");
  writeFileSync(join(tempDir, "b.txt"), "hello universe\nno match here");
  mkdirSync(join(tempDir, "sub"));
  writeFileSync(join(tempDir, "sub", "c.txt"), "hello nested");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("GrepTool", () => {
  test("finds files with matches (default mode)", async () => {
    const result = await GrepTool.execute({ pattern: "hello" }, context);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("a.txt");
    expect(result.output).toContain("b.txt");
    expect(result.output).toContain("c.txt");
  });

  test("shows content in content mode", async () => {
    const result = await GrepTool.execute(
      { pattern: "hello", output_mode: "content" },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("hello");
  });

  test("returns no matches message", async () => {
    const result = await GrepTool.execute(
      { pattern: "nonexistent_pattern_xyz" },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("No");
  });

  test("requires pattern parameter", async () => {
    const result = await runTool({ pattern: "" });
    expect(result.error).toBe(true);
  });

  test("respects case insensitive flag", async () => {
    writeFileSync(join(tempDir, "case.txt"), "Hello World");
    const result = await GrepTool.execute(
      { pattern: "hello world", "-i": true },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("case.txt");
  });
});
