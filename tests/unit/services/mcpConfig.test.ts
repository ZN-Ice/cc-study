/**
 * Tests for MCP configuration loading
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { loadMcpConfig } from "../../../src/services/mcpConfig.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadMcpConfig", () => {
  const originalHomedir = process.env.HOME;
  let tmpDir: string;
  let fakeHome: string;

  beforeEach(() => {
    // Create a fake home directory without ~/.claude.json for test isolation
    fakeHome = join(tmpdir(), `fake-home-${Date.now()}-${Math.random()}`);
    mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;

    tmpDir = join(tmpdir(), `mcp-config-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    if (existsSync(fakeHome)) {
      rmSync(fakeHome, { recursive: true, force: true });
    }
    if (originalHomedir) {
      process.env.HOME = originalHomedir;
    }
  });

  test("returns null when no .mcp.json exists and no global config exists", () => {
    const result = loadMcpConfig(tmpDir);
    // With fake home (no ~/.claude.json), result should be null when no local .mcp.json exists
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

  test("handles invalid JSON in local .mcp.json gracefully", () => {
    // Write global config to fake home so we can test fallback when local JSON is invalid
    const globalConfig = {
      mcpServers: {
        globalFallback: { command: "echo", args: ["global"] },
      },
    };
    writeFileSync(join(fakeHome, ".claude.json"), JSON.stringify(globalConfig));

    writeFileSync(join(tmpDir, ".mcp.json"), "not valid json {{{");

    const result = loadMcpConfig(tmpDir);
    // Should still return global config since local parse failure is ignored
    expect(result).not.toBeNull();
    expect(result!.mcpServers.globalFallback).toBeDefined();
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

  test("returns local mcpServers when .mcp.json has no mcpServers key", () => {
    // Write global config to fake home for merging test
    const globalConfig = {
      mcpServers: {
        globalServer: { command: "echo", args: ["global"] },
      },
    };
    writeFileSync(join(fakeHome, ".claude.json"), JSON.stringify(globalConfig));

    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({ other: {} }));

    const result = loadMcpConfig(tmpDir);
    expect(result).not.toBeNull();
    // Local .mcp.json has empty mcpServers (because mcpServers key is missing)
    // But global config has servers, so they should be merged
    expect(result!.mcpServers.globalServer).toBeDefined();
  });
});

describe("loadMcpConfig with global config", () => {
  const originalHomedir = process.env.HOME;

  afterEach(() => {
    // Restore original HOME if it was changed
    if (originalHomedir) {
      process.env.HOME = originalHomedir;
    }
  });

  test("loads mcpServers from global ~/.claude.json when no local .mcp.json exists", async () => {
    // Create a fake home directory
    const fakeHome = join(tmpdir(), `fake-home-${Date.now()}-${Math.random()}`);
    mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;

    // Write global config to simulated home directory
    const globalConfig = {
      mcpServers: {
        "web-search-prime": {
          type: "http",
          url: "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
          headers: { Authorization: "Bearer test-token" },
        },
        "zread": {
          type: "http",
          url: "https://open.bigmodel.cn/api/mcp/zread/mcp",
          headers: { Authorization: "Bearer test-token" },
        },
      },
    };
    writeFileSync(join(fakeHome, ".claude.json"), JSON.stringify(globalConfig));

    // Create a temp project dir that doesn't have .mcp.json
    const projectDir = join(tmpdir(), `project-${Date.now()}-${Math.random()}`);
    mkdirSync(projectDir, { recursive: true });

    // Need to re-import to pick up the new HOME
    const { loadMcpConfig: reload } = await import("../../../src/services/mcpConfig.js");
    const result = reload(projectDir);

    expect(result).not.toBeNull();
    expect(result!.mcpServers["web-search-prime"]).toBeDefined();
    expect(result!.mcpServers["web-search-prime"].type).toBe("http");
    expect(result!.mcpServers["zread"]).toBeDefined();

    // Cleanup
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("local .mcp.json overrides global ~/.claude.json for same server name", async () => {
    // Create a fake home directory
    const fakeHome = join(tmpdir(), `fake-home-${Date.now()}-${Math.random()}`);
    mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;

    // Write global config
    const globalConfig = {
      mcpServers: {
        testServer: {
          type: "http",
          url: "https://global.example.com",
        },
      },
    };
    writeFileSync(join(fakeHome, ".claude.json"), JSON.stringify(globalConfig));

    // Create project dir with local .mcp.json
    const projectDir = join(tmpdir(), `project-${Date.now()}-${Math.random()}`);
    mkdirSync(projectDir, { recursive: true });
    const localConfig = {
      mcpServers: {
        testServer: {
          type: "stdio",
          command: "local-cmd",
        },
      },
    };
    writeFileSync(join(projectDir, ".mcp.json"), JSON.stringify(localConfig));

    const { loadMcpConfig: reload } = await import("../../../src/services/mcpConfig.js");
    const result = reload(projectDir);

    expect(result).not.toBeNull();
    // Local should override global
    expect(result!.mcpServers["testServer"].type).toBe("stdio");
    expect((result!.mcpServers["testServer"] as { command: string }).command).toBe("local-cmd");

    // Cleanup
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("merges local and global servers when they have different names", async () => {
    // Create a fake home directory
    const fakeHome = join(tmpdir(), `fake-home-${Date.now()}-${Math.random()}`);
    mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;

    // Write global config
    const globalConfig = {
      mcpServers: {
        globalServer: {
          type: "http",
          url: "https://global.example.com",
        },
      },
    };
    writeFileSync(join(fakeHome, ".claude.json"), JSON.stringify(globalConfig));

    // Create project dir with local .mcp.json with different server name
    const projectDir = join(tmpdir(), `project-${Date.now()}-${Math.random()}`);
    mkdirSync(projectDir, { recursive: true });
    const localConfig = {
      mcpServers: {
        localServer: {
          type: "stdio",
          command: "local-cmd",
        },
      },
    };
    writeFileSync(join(projectDir, ".mcp.json"), JSON.stringify(localConfig));

    const { loadMcpConfig: reload } = await import("../../../src/services/mcpConfig.js");
    const result = reload(projectDir);

    expect(result).not.toBeNull();
    expect(result!.mcpServers["globalServer"]).toBeDefined();
    expect(result!.mcpServers["localServer"]).toBeDefined();
    expect(Object.keys(result!.mcpServers)).toHaveLength(2);

    // Cleanup
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("handles invalid JSON in global ~/.claude.json gracefully", async () => {
    // Create a fake home directory
    const fakeHome = join(tmpdir(), `fake-home-${Date.now()}-${Math.random()}`);
    mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;

    // Write valid local config
    const localConfig = {
      mcpServers: {
        localServer: { command: "local-cmd" },
      },
    };
    const projectDir = join(tmpdir(), `project-${Date.now()}-${Math.random()}`);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, ".mcp.json"), JSON.stringify(localConfig));

    // Write invalid global config
    writeFileSync(join(fakeHome, ".claude.json"), "not valid json {{{");

    const { loadMcpConfig: reload } = await import("../../../src/services/mcpConfig.js");
    const result = reload(projectDir);

    // Should still return local config since global parse failure is ignored
    expect(result).not.toBeNull();
    expect(result!.mcpServers["localServer"]).toBeDefined();

    // Cleanup
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("handles global ~/.claude.json with no mcpServers key", async () => {
    // Create a fake home directory
    const fakeHome = join(tmpdir(), `fake-home-${Date.now()}-${Math.random()}`);
    mkdirSync(fakeHome, { recursive: true });
    process.env.HOME = fakeHome;

    // Write global config without mcpServers
    const globalConfig = {
      numStartups: 23,
      installMethod: "global",
    };
    writeFileSync(join(fakeHome, ".claude.json"), JSON.stringify(globalConfig));

    // Write valid local config
    const localConfig = {
      mcpServers: {
        localServer: { command: "local-cmd" },
      },
    };
    const projectDir = join(tmpdir(), `project-${Date.now()}-${Math.random()}`);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, ".mcp.json"), JSON.stringify(localConfig));

    const { loadMcpConfig: reload } = await import("../../../src/services/mcpConfig.js");
    const result = reload(projectDir);

    expect(result).not.toBeNull();
    expect(result!.mcpServers["localServer"]).toBeDefined();

    // Cleanup
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });
});
