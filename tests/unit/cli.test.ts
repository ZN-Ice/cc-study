import { describe, test, expect, vi, beforeEach } from "vitest";
import { parseCliArgs } from "../../src/cli.js";

describe("parseCliArgs", () => {
  test("parses --version flag", () => {
    const result = parseCliArgs(["--version"]);
    expect(result.version).toBe(true);
  });

  test("parses -v flag as --version", () => {
    const result = parseCliArgs(["-v"]);
    expect(result.version).toBe(true);
  });

  test("parses --help flag", () => {
    const result = parseCliArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  test("parses -h flag as --help", () => {
    const result = parseCliArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  test("parses --model option", () => {
    const result = parseCliArgs(["--model", "claude-opus-4-6"]);
    expect(result.model).toBe("claude-opus-4-6");
  });

  test("parses --debug flag", () => {
    const result = parseCliArgs(["--debug"]);
    expect(result.debug).toBe(true);
  });

  test("returns defaults when no args provided", () => {
    const result = parseCliArgs([]);
    expect(result.version).toBe(false);
    expect(result.help).toBe(false);
    expect(result.debug).toBe(false);
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  test("parses multiple flags together", () => {
    const result = parseCliArgs(["--debug", "--model", "claude-haiku-4-5"]);
    expect(result.debug).toBe(true);
    expect(result.model).toBe("claude-haiku-4-5");
  });
});
