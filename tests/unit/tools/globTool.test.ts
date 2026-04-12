/**
 * Tests for GlobTool
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GlobTool } from "../../../src/tools/GlobTool.js";
import type { ToolContext } from "../../../src/tools/types.js";

let tempDir: string;
const context: ToolContext = {
  workingDirectory: "",
  abortSignal: new AbortController().signal,
};

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cc-study-test-"));
  context.workingDirectory = tempDir;
  // Create test files
  writeFileSync(join(tempDir, "a.ts"), "a");
  writeFileSync(join(tempDir, "b.ts"), "b");
  writeFileSync(join(tempDir, "c.js"), "c");
  mkdirSync(join(tempDir, "sub"));
  writeFileSync(join(tempDir, "sub", "d.ts"), "d");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("GlobTool", () => {
  test("finds files matching pattern", async () => {
    const result = await GlobTool.execute({ pattern: "**/*.ts" }, context);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("a.ts");
    expect(result.output).toContain("b.ts");
    expect(result.output).toContain("d.ts");
  });

  test("excludes non-matching files", async () => {
    const result = await GlobTool.execute({ pattern: "*.js" }, context);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("c.js");
    expect(result.output).not.toContain(".ts");
  });

  test("returns no files message for no matches", async () => {
    const result = await GlobTool.execute({ pattern: "*.xyz" }, context);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("No files");
  });

  test("requires pattern parameter", async () => {
    const result = await GlobTool.execute({ pattern: "" }, context);
    expect(result.error).toBe(true);
  });

  test("respects custom path", async () => {
    const result = await GlobTool.execute(
      { pattern: "*.ts", path: join(tempDir, "sub") },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("d.ts");
    expect(result.output).not.toContain("a.ts");
  });
});
