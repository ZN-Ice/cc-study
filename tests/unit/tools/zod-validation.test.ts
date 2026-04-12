/**
 * Tests for Zod schema validation and validateInput lifecycle.
 *
 * Covers:
 * - Zod strictObject rejects unknown fields (LLM hallucination protection)
 * - Zod type validation (wrong types, missing required fields)
 * - validateInput semantic checks for each tool
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { ToolRegistry, executeTool } from "../../../src/tools/registry.js";
import { FileReadTool } from "../../../src/tools/FileReadTool.js";
import { FileWriteTool } from "../../../src/tools/FileWriteTool.js";
import { FileEditTool } from "../../../src/tools/FileEditTool.js";
import { BashTool } from "../../../src/tools/BashTool.js";
import { GlobTool } from "../../../src/tools/GlobTool.js";
import { GrepTool } from "../../../src/tools/GrepTool.js";
import type { ToolContext } from "../../../src/tools/types.js";

let tempDir: string;
const context: ToolContext = {
  workingDirectory: "",
  abortSignal: new AbortController().signal,
};

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cc-study-zod-"));
  context.workingDirectory = tempDir;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Helper: create registry with a single tool and run executeTool */
async function runTool(
  tool: { name: string },
  input: Record<string, unknown>,
) {
  const registry = new ToolRegistry();
  registry.register(
    tool as unknown as import("../../../src/tools/types.js").Tool,
  );
  return executeTool(registry, tool.name, input, context);
}

// ── Zod schema validation ──────────────────────────────────────

describe("Zod schema validation", () => {
  test("rejects unknown fields (strictObject)", async () => {
    const result = await runTool(
      FileReadTool,
      { file_path: "/tmp/test.txt", hallucinated_field: "evil" },
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("Invalid parameters");
  });

  test("rejects missing required fields", async () => {
    const result = await runTool(FileReadTool, {});
    expect(result.error).toBe(true);
    expect(result.output).toContain("Invalid parameters");
    expect(result.output).toContain("file_path");
  });

  test("rejects wrong type for parameter", async () => {
    const result = await runTool(
      FileReadTool,
      { file_path: 12345 },
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("Invalid parameters");
  });

  test("accepts optional fields omitted", async () => {
    writeFileSync(join(tempDir, "test.txt"), "hello");
    const result = await runTool(
      FileReadTool,
      { file_path: join(tempDir, "test.txt") },
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("hello");
  });

  test("rejects unknown enum value in GrepTool output_mode", async () => {
    const result = await runTool(
      GrepTool,
      { pattern: "test", output_mode: "invalid_mode" },
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("Invalid parameters");
  });

  test("FileWriteTool rejects missing content", async () => {
    const result = await runTool(
      FileWriteTool,
      { file_path: join(tempDir, "test.txt") },
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("Invalid parameters");
    expect(result.output).toContain("content");
  });

  test("FileEditTool accepts optional replace_all", async () => {
    writeFileSync(join(tempDir, "test.txt"), "hello world");
    const result = await runTool(
      FileEditTool,
      { file_path: join(tempDir, "test.txt"), old_string: "world", new_string: "universe", replace_all: true },
    );
    expect(result.error).toBeUndefined();
  });
});

// ── validateInput semantic checks ──────────────────────────────

describe("validateInput semantic checks", () => {
  test("FileReadTool: rejects binary file by extension", async () => {
    writeFileSync(join(tempDir, "test.png"), Buffer.from([0x89, 0x50]));
    const result = await runTool(
      FileReadTool,
      { file_path: join(tempDir, "test.png") },
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("binary");
  });

  test("FileReadTool: rejects file exceeding size limit", async () => {
    writeFileSync(join(tempDir, "big.txt"), "x".repeat(300 * 1024));
    const result = await runTool(
      FileReadTool,
      { file_path: join(tempDir, "big.txt") },
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("exceeds maximum");
  });

  test("FileReadTool: allows reading large file with limit", async () => {
    writeFileSync(join(tempDir, "big.txt"), "x".repeat(300 * 1024));
    const result = await runTool(
      FileReadTool,
      { file_path: join(tempDir, "big.txt"), limit: 10 },
    );
    expect(result.error).toBeUndefined();
  });

  test("FileReadTool: rejects non-existent file", async () => {
    const result = await runTool(
      FileReadTool,
      { file_path: join(tempDir, "missing.txt") },
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("not found");
  });

  test("FileEditTool: rejects identical old_string and new_string", async () => {
    writeFileSync(join(tempDir, "test.txt"), "hello");
    const result = await runTool(
      FileEditTool,
      { file_path: join(tempDir, "test.txt"), old_string: "hello", new_string: "hello" },
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("identical");
  });

  test("FileEditTool: rejects non-unique match without replace_all", async () => {
    writeFileSync(join(tempDir, "test.txt"), "foo bar foo baz foo");
    const result = await runTool(
      FileEditTool,
      { file_path: join(tempDir, "test.txt"), old_string: "foo", new_string: "qux" },
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("3 matches");
  });

  test("FileEditTool: rejects creating file when file exists", async () => {
    writeFileSync(join(tempDir, "test.txt"), "existing");
    const result = await runTool(
      FileEditTool,
      { file_path: join(tempDir, "test.txt"), old_string: "", new_string: "new" },
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("already exists");
  });

  test("FileEditTool: rejects non-existent file for edit", async () => {
    const result = await runTool(
      FileEditTool,
      { file_path: join(tempDir, "missing.txt"), old_string: "x", new_string: "y" },
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("not found");
  });

  test("FileEditTool: allows creating new file with empty old_string", async () => {
    const result = await runTool(
      FileEditTool,
      { file_path: join(tempDir, "new.txt"), old_string: "", new_string: "content" },
    );
    expect(result.error).toBeUndefined();
  });

  test("BashTool: rejects empty command", async () => {
    const result = await runTool(BashTool, { command: "" });
    expect(result.error).toBe(true);
    expect(result.output).toContain("Empty");
  });

  test("BashTool: rejects whitespace-only command", async () => {
    const result = await runTool(BashTool, { command: "   " });
    expect(result.error).toBe(true);
    expect(result.output).toContain("Empty");
  });

  test("GrepTool: rejects empty pattern", async () => {
    const result = await runTool(GrepTool, { pattern: "" });
    expect(result.error).toBe(true);
    expect(result.output).toContain("pattern");
  });
});

// ── Zod schema to JSON Schema conversion ───────────────────────

describe("Zod schema → JSON Schema", () => {
  test("generates correct ToolDefinition from Zod schema", () => {
    const registry = new ToolRegistry();
    registry.register(FileReadTool);
    const defs = registry.getToolDefinitions();

    const readDef = defs.find((d) => d.name === "Read");
    expect(readDef).toBeDefined();
    expect(readDef!.input_schema.type).toBe("object");
    expect(readDef!.input_schema.required).toContain("file_path");
    expect(readDef!.input_schema.required).not.toContain("offset");
    expect(readDef!.input_schema.required).not.toContain("limit");
    expect(readDef!.input_schema.properties).toHaveProperty("file_path");
    expect(readDef!.input_schema.properties).toHaveProperty("offset");
  });

  test("all 6 tools generate valid definitions", () => {
    const registry = new ToolRegistry();
    registry.register(FileReadTool);
    registry.register(FileWriteTool);
    registry.register(FileEditTool);
    registry.register(BashTool);
    registry.register(GlobTool);
    registry.register(GrepTool);

    const defs = registry.getToolDefinitions();
    expect(defs).toHaveLength(6);
    for (const def of defs) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.input_schema.type).toBe("object");
      expect(def.input_schema.properties).toBeDefined();
    }
  });
});
