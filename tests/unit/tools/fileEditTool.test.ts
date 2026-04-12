/**
 * Tests for FileEditTool
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileEditTool } from "../../../src/tools/FileEditTool.js";
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

describe("FileEditTool", () => {
  test("replaces a unique string", async () => {
    writeFileSync(join(tempDir, "test.txt"), "hello world");
    const result = await FileEditTool.execute(
      { file_path: join(tempDir, "test.txt"), old_string: "world", new_string: "universe" },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("updated");
    expect(readFileSync(join(tempDir, "test.txt"), "utf-8")).toBe("hello universe");
  });

  test("rejects identical old_string and new_string", async () => {
    writeFileSync(join(tempDir, "test.txt"), "hello");
    const result = await FileEditTool.execute(
      { file_path: join(tempDir, "test.txt"), old_string: "hello", new_string: "hello" },
      context,
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("identical");
  });

  test("rejects non-unique old_string without replace_all", async () => {
    writeFileSync(join(tempDir, "test.txt"), "foo bar foo baz foo");
    const result = await FileEditTool.execute(
      { file_path: join(tempDir, "test.txt"), old_string: "foo", new_string: "qux" },
      context,
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("3 matches");
  });

  test("replaces all occurrences with replace_all", async () => {
    writeFileSync(join(tempDir, "test.txt"), "foo bar foo baz foo");
    const result = await FileEditTool.execute(
      { file_path: join(tempDir, "test.txt"), old_string: "foo", new_string: "qux", replace_all: true },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(readFileSync(join(tempDir, "test.txt"), "utf-8")).toBe("qux bar qux baz qux");
  });

  test("rejects when old_string not found", async () => {
    writeFileSync(join(tempDir, "test.txt"), "hello");
    const result = await FileEditTool.execute(
      { file_path: join(tempDir, "test.txt"), old_string: "missing", new_string: "found" },
      context,
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("not found");
  });

  test("creates new file with empty old_string", async () => {
    const result = await FileEditTool.execute(
      { file_path: join(tempDir, "new.txt"), old_string: "", new_string: "new content" },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(readFileSync(join(tempDir, "new.txt"), "utf-8")).toBe("new content");
  });

  test("rejects creating file when file exists and non-empty", async () => {
    writeFileSync(join(tempDir, "test.txt"), "existing content");
    const result = await FileEditTool.execute(
      { file_path: join(tempDir, "test.txt"), old_string: "", new_string: "new" },
      context,
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("already exists");
  });

  test("handles delete (empty new_string) with trailing newline", async () => {
    writeFileSync(join(tempDir, "test.txt"), "line1\nto_delete\nline3");
    const result = await FileEditTool.execute(
      { file_path: join(tempDir, "test.txt"), old_string: "to_delete", new_string: "" },
      context,
    );
    expect(result.error).toBeUndefined();
    const content = readFileSync(join(tempDir, "test.txt"), "utf-8");
    expect(content).toBe("line1\nline3");
  });

  test("handles $ special characters in replacement", async () => {
    writeFileSync(join(tempDir, "test.txt"), "price: OLD");
    const result = await FileEditTool.execute(
      { file_path: join(tempDir, "test.txt"), old_string: "OLD", new_string: "$10.99" },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(readFileSync(join(tempDir, "test.txt"), "utf-8")).toBe("price: $10.99");
  });

  test("returns error for non-existent file", async () => {
    const result = await FileEditTool.execute(
      { file_path: join(tempDir, "missing.txt"), old_string: "x", new_string: "y" },
      context,
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("not found");
  });
});
