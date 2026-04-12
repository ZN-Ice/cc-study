/**
 * Tests for BashTool
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BashTool } from "../../../src/tools/BashTool.js";
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

describe("BashTool", () => {
  test("executes a simple command", async () => {
    const result = await BashTool.execute({ command: "echo hello" }, context);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("hello");
  });

  test("captures stderr", async () => {
    const result = await BashTool.execute(
      { command: "echo error >&2 && echo ok" },
      context,
    );
    expect(result.output).toContain("error");
    expect(result.output).toContain("ok");
  });

  test("returns error for non-zero exit code", async () => {
    const result = await BashTool.execute(
      { command: "exit 42" },
      context,
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("42");
  });

  test("respects working directory", async () => {
    const result = await BashTool.execute({ command: "pwd" }, context);
    // macOS may resolve /var to /private/var via symlink
    expect(result.output.trim()).toContain("cc-study-test-");
    expect(result.output.trim()).toContain(tempDir.split("cc-study-test-")[0].split("/").pop()!);
  });

  test("rejects empty command", async () => {
    const result = await BashTool.execute({ command: "" }, context);
    expect(result.error).toBe(true);
    expect(result.output).toContain("Empty");
  });

  test("times out with custom timeout", async () => {
    const result = await BashTool.execute(
      { command: "sleep 10", timeout: 500 },
      context,
    );
    expect(result.error).toBe(true);
    expect(result.output).toContain("timed out");
  }, 5000);

  test("handles abort signal", async () => {
    const controller = new AbortController();
    const ctx = { ...context, abortSignal: controller.signal };

    const promise = BashTool.execute({ command: "sleep 10" }, ctx);
    // Abort after a short delay
    setTimeout(() => controller.abort(), 100);

    const result = await promise;
    expect(result.error).toBe(true);
  }, 5000);
});
