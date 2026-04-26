/**
 * Tests for Tool interface helper methods (isReadOnly, isConcurrencySafe, getPath)
 * on existing tools.
 */

import { describe, test, expect } from "vitest";
import { FileReadTool } from "../../../../src/tools/FileReadTool.js";
import { FileWriteTool } from "../../../../src/tools/FileWriteTool.js";
import { FileEditTool } from "../../../../src/tools/FileEditTool.js";
import { BashTool } from "../../../../src/tools/BashTool.js";
import { GlobTool } from "../../../../src/tools/GlobTool.js";
import { GrepTool } from "../../../../src/tools/GrepTool.js";

describe("FileReadTool helpers", () => {
  test("isReadOnly returns true", () => {
    expect(FileReadTool.isReadOnly!({ file_path: "/tmp/test.txt" })).toBe(true);
  });

  test("isConcurrencySafe returns true", () => {
    expect(FileReadTool.isConcurrencySafe!({ file_path: "/tmp/test.txt" })).toBe(true);
  });

  test("getPath returns file_path", () => {
    expect(FileReadTool.getPath!({ file_path: "/tmp/test.txt" })).toBe("/tmp/test.txt");
  });
});

describe("FileWriteTool helpers", () => {
  test("getPath returns file_path", () => {
    expect(FileWriteTool.getPath!({ file_path: "/tmp/test.txt", content: "hello" })).toBe("/tmp/test.txt");
  });
});

describe("FileEditTool helpers", () => {
  test("getPath returns file_path", () => {
    expect(
      FileEditTool.getPath!({
        file_path: "/tmp/test.txt",
        old_string: "old",
        new_string: "new",
      }),
    ).toBe("/tmp/test.txt");
  });
});

describe("BashTool helpers", () => {
  test("isReadOnly returns true for read-only commands", () => {
    expect(BashTool.isReadOnly!({ command: "ls -la" })).toBe(true);
    expect(BashTool.isReadOnly!({ command: "cat file.txt" })).toBe(true);
    expect(BashTool.isReadOnly!({ command: "grep pattern file" })).toBe(true);
    expect(BashTool.isReadOnly!({ command: "git status" })).toBe(true);
    expect(BashTool.isReadOnly!({ command: "pwd" })).toBe(true);
  });

  test("isReadOnly returns false for write commands", () => {
    expect(BashTool.isReadOnly!({ command: "npm install" })).toBe(false);
    expect(BashTool.isReadOnly!({ command: "echo hello > file" })).toBe(false);
    expect(BashTool.isReadOnly!({ command: "rm file.txt" })).toBe(false);
  });
});

describe("GlobTool helpers", () => {
  test("isReadOnly returns true", () => {
    expect(GlobTool.isReadOnly!({ pattern: "**/*.ts" })).toBe(true);
  });

  test("isConcurrencySafe returns true", () => {
    expect(GlobTool.isConcurrencySafe!({ pattern: "**/*.ts" })).toBe(true);
  });
});

describe("GrepTool helpers", () => {
  test("isReadOnly returns true", () => {
    expect(GrepTool.isReadOnly!({ pattern: "TODO" })).toBe(true);
  });

  test("isConcurrencySafe returns true", () => {
    expect(GrepTool.isConcurrencySafe!({ pattern: "TODO" })).toBe(true);
  });
});
