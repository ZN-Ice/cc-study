/**
 * Tests for FileReadTool
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileReadTool } from "../../../src/tools/FileReadTool.js";
import { ToolRegistry, executeTool } from "../../../src/tools/registry.js";
import type { ToolContext } from "../../../src/tools/types.js";

let tempDir: string;
const context: ToolContext = {
  workingDirectory: "",
  abortSignal: new AbortController().signal,
};

/** Run FileReadTool through the full lifecycle (Zod parse → validateInput → execute) */
async function runTool(input: Record<string, unknown>) {
  const registry = new ToolRegistry();
  registry.register(FileReadTool);
  return executeTool(registry, "Read", input, context);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cc-study-test-"));
  context.workingDirectory = tempDir;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("FileReadTool", () => {
  test("reads an existing text file", async () => {
    writeFileSync(join(tempDir, "test.txt"), "hello world\nline 2\nline 3");
    const result = await FileReadTool.execute(
      { file_path: join(tempDir, "test.txt") },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("hello world");
    expect(result.output).toContain("line 2");
    expect(result.output).toContain("3 lines total");
  });

  test("returns error for non-existent file", async () => {
    const result = await runTool({ file_path: join(tempDir, "missing.txt") });
    expect(result.error).toBe(true);
    expect(result.output).toContain("not found");
  });

  test("supports offset parameter", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(tempDir, "test.txt"), lines.join("\n"));
    const result = await FileReadTool.execute(
      { file_path: join(tempDir, "test.txt"), offset: 5 },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("line 5");
    expect(result.output).not.toContain("line 4");
  });

  test("supports limit parameter", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(tempDir, "test.txt"), lines.join("\n"));
    const result = await FileReadTool.execute(
      { file_path: join(tempDir, "test.txt"), offset: 3, limit: 2 },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("line 3");
    expect(result.output).toContain("line 4");
    expect(result.output).not.toContain("line 5");
    expect(result.output).toContain("lines 3-4 of 10");
  });

  test("rejects binary files", async () => {
    writeFileSync(join(tempDir, "test.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await runTool({ file_path: join(tempDir, "test.png") });
    expect(result.error).toBe(true);
    expect(result.output).toContain("binary");
  });

  test("rejects oversized files without limit", async () => {
    const bigContent = "x".repeat(300 * 1024); // 300KB
    writeFileSync(join(tempDir, "big.txt"), bigContent);
    const result = await runTool({ file_path: join(tempDir, "big.txt") });
    expect(result.error).toBe(true);
    expect(result.output).toContain("exceeds maximum");
  });

  test("allows reading portions of oversized files with limit", async () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i + 1}: ${"x".repeat(60)}`);
    writeFileSync(join(tempDir, "big.txt"), lines.join("\n"));
    const result = await FileReadTool.execute(
      { file_path: join(tempDir, "big.txt"), offset: 1, limit: 10 },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("line 1:");
  });

  test("adds line numbers in cat -n format", async () => {
    writeFileSync(join(tempDir, "test.txt"), "alpha\nbeta\ngamma");
    const result = await FileReadTool.execute(
      { file_path: join(tempDir, "test.txt") },
      context,
    );
    expect(result.output).toMatch(/→alpha/);
    expect(result.output).toMatch(/→beta/);
    expect(result.output).toMatch(/→gamma/);
  });
});
