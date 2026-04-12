/**
 * Tests for FileWriteTool
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileWriteTool } from "../../../src/tools/FileWriteTool.js";
import type { ToolContext } from "../../../src/tools/types.js";

let tempDir: string;
const context: ToolContext = {
  workingDirectory: "",
  abortSignal: new AbortController().signal,
};

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cc-study-test-"));
  context.workingDirectory = tempDir;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("FileWriteTool", () => {
  test("creates a new file", async () => {
    const result = await FileWriteTool.execute(
      { file_path: join(tempDir, "new.txt"), content: "hello" },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("created");
    expect(readFileSync(join(tempDir, "new.txt"), "utf-8")).toBe("hello");
  });

  test("overwrites an existing file", async () => {
    writeFileSync(join(tempDir, "existing.txt"), "old content");
    const result = await FileWriteTool.execute(
      { file_path: join(tempDir, "existing.txt"), content: "new content" },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("updated");
    expect(readFileSync(join(tempDir, "existing.txt"), "utf-8")).toBe("new content");
  });

  test("creates parent directories automatically", async () => {
    const result = await FileWriteTool.execute(
      { file_path: join(tempDir, "sub", "dir", "file.txt"), content: "nested" },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(readFileSync(join(tempDir, "sub", "dir", "file.txt"), "utf-8")).toBe("nested");
  });

  test("requires file_path parameter", async () => {
    const result = await FileWriteTool.execute(
      { content: "test" },
      context,
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("required");
  });

  test("writes empty content", async () => {
    const result = await FileWriteTool.execute(
      { file_path: join(tempDir, "empty.txt"), content: "" },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(readFileSync(join(tempDir, "empty.txt"), "utf-8")).toBe("");
  });

  test("preserves UTF-8 content", async () => {
    const content = "你好世界 🌍 Ñoño café";
    const result = await FileWriteTool.execute(
      { file_path: join(tempDir, "utf8.txt"), content },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(readFileSync(join(tempDir, "utf8.txt"), "utf-8")).toBe(content);
  });
});
