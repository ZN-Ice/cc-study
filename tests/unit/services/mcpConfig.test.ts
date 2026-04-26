/**
 * Tests for MCP configuration loading
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { loadMcpConfig } from "../../../src/services/mcpConfig.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadMcpConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mcp-config-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns null when no .mcp.json exists", () => {
    const result = loadMcpConfig(tmpDir);
    expect(result).toBeNull();
  });

  test("loads .mcp.json from specified directory", () => {
    const config = {
      mcpServers: {
        testServer: {
          command: "npx",
          args: ["-y", "test-server"],
        },
      },
    };
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify(config));

    const result = loadMcpConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.mcpServers.testServer.command).toBe("npx");
    expect(result!.mcpServers.testServer.args).toEqual(["-y", "test-server"]);
  });

  test("traverses parent directories to find .mcp.json", () => {
    const config = {
      mcpServers: {
        parent: {
          command: "node",
          args: ["server.js"],
        },
      },
    };
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify(config));

    const childDir = join(tmpDir, "child", "nested");
    mkdirSync(childDir, { recursive: true });

    const result = loadMcpConfig(childDir);
    expect(result).not.toBeNull();
    expect(result!.mcpServers.parent.command).toBe("node");
  });

  test("returns closest .mcp.json when multiple exist", () => {
    const parentConfig = {
      mcpServers: { server: { command: "parent" } },
    };
    const childConfig = {
      mcpServers: { server: { command: "child" } },
    };

    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify(parentConfig));

    const childDir = join(tmpDir, "child");
    mkdirSync(childDir, { recursive: true });
    writeFileSync(join(childDir, ".mcp.json"), JSON.stringify(childConfig));

    const result = loadMcpConfig(childDir);
    expect(result).not.toBeNull();
    expect(result!.mcpServers.server.command).toBe("child");
  });

  test("handles invalid JSON gracefully", () => {
    writeFileSync(join(tmpDir, ".mcp.json"), "not valid json {{{");

    const result = loadMcpConfig(tmpDir);
    expect(result).toBeNull();
  });

  test("parses server config with env variables", () => {
    const config = {
      mcpServers: {
        withEnv: {
          command: "npx",
          args: ["-y", "server"],
          env: { API_KEY: "secret", DEBUG: "true" },
        },
      },
    };
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify(config));

    const result = loadMcpConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.mcpServers.withEnv.env).toEqual({
      API_KEY: "secret",
      DEBUG: "true",
    });
  });

  test("parses server config with type field", () => {
    const config = {
      mcpServers: {
        stdio: {
          type: "stdio",
          command: "node",
          args: ["server.js"],
        },
      },
    };
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify(config));

    const result = loadMcpConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.mcpServers.stdio.type).toBe("stdio");
  });

  test("parses server config without type defaults correctly", () => {
    const config = {
      mcpServers: {
        minimal: {
          command: "echo",
        },
      },
    };
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify(config));

    const result = loadMcpConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.mcpServers.minimal.command).toBe("echo");
    expect(result!.mcpServers.minimal.args).toBeUndefined();
  });

  test("returns null when .mcp.json has no mcpServers key", () => {
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({ other: {} }));

    const result = loadMcpConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.mcpServers).toEqual({});
  });
});
