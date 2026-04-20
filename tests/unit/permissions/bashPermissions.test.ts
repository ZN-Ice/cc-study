/**
 * BashTool.checkPermissions tests.
 *
 * Tests the tool-level security check:
 * - Always-deny commands (rm -rf /, fork bomb, etc.)
 * - Ask-for-permission commands (sudo, chmod, chown)
 * - Passthrough (normal commands)
 */

import { describe, test, expect } from "vitest";
import { BashTool } from "../../../src/tools/BashTool.js";
import type { ToolContext } from "../../../src/tools/types.js";
import type { ToolPermissionContext } from "../../../src/permissions/types.js";

function makeToolContext(): ToolContext {
  return {
    workingDirectory: "/test",
    abortSignal: new AbortController().signal,
  };
}

function makePermContext(): ToolPermissionContext {
  return {
    mode: "default",
    allowRules: [],
    denyRules: [],
    askRules: [],
  };
}

async function check(cmd: string) {
  return BashTool.checkPermissions!({ command: cmd }, makeToolContext(), makePermContext());
}

// ──────────────────────────────────────────────
// Always deny
// ──────────────────────────────────────────────

describe("BashTool.checkPermissions — always deny", () => {
  test("blocks rm -rf /", async () => {
    const result = await check("rm -rf /");
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain("blocked");
  });

  test("blocks rm -rf *", async () => {
    const result = await check("rm -rf *");
    expect(result.behavior).toBe("deny");
  });

  test("blocks rm -fr /", async () => {
    const result = await check("rm -fr /");
    expect(result.behavior).toBe("deny");
  });

  test("blocks rm --recursive --force /", async () => {
    const result = await check("rm --recursive --force /");
    expect(result.behavior).toBe("deny");
  });

  test("blocks fork bomb", async () => {
    const result = await check(":(){ :|:& };:");
    expect(result.behavior).toBe("deny");
  });
});

// ──────────────────────────────────────────────
// Ask for permission
// ──────────────────────────────────────────────

describe("BashTool.checkPermissions — ask for sensitive commands", () => {
  test("asks for sudo commands", async () => {
    const result = await check("sudo apt install foo");
    expect(result.behavior).toBe("ask");
    expect(result.message).toContain("sensitive");
  });

  test("asks for chown", async () => {
    const result = await check("chown root:root /etc/hosts");
    expect(result.behavior).toBe("ask");
  });

  test("asks for shutdown", async () => {
    const result = await check("shutdown -h now");
    expect(result.behavior).toBe("ask");
  });

  test("asks for reboot", async () => {
    const result = await check("reboot");
    expect(result.behavior).toBe("ask");
  });
});

// ──────────────────────────────────────────────
// Passthrough (allow)
// ──────────────────────────────────────────────

describe("BashTool.checkPermissions — passthrough", () => {
  test("allows normal commands", async () => {
    const result = await check("ls -la");
    expect(result.behavior).toBe("allow");
  });

  test("allows npm install", async () => {
    const result = await check("npm install");
    expect(result.behavior).toBe("allow");
  });

  test("allows git status", async () => {
    const result = await check("git status");
    expect(result.behavior).toBe("allow");
  });

  test("allows rm with specific path (not / or *)", async () => {
    const result = await check("rm -rf node_modules");
    expect(result.behavior).toBe("allow");
  });

  test("allows echo", async () => {
    const result = await check("echo hello");
    expect(result.behavior).toBe("allow");
  });
});
