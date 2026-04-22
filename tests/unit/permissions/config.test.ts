/**
 * Permission config file read/write tests.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadPermissionConfigFromFile,
  savePermissionRule,
  getProjectSettingsPath,
} from "../../../src/permissions/config.js";

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `cc-study-perm-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ──────────────────────────────────────────────
// loadPermissionConfigFromFile
// ──────────────────────────────────────────────

describe("loadPermissionConfigFromFile", () => {
  test("loads config from existing file", async () => {
    const configPath = join(testDir, "settings.json");
    await writeFile(
      configPath,
      JSON.stringify({
        permissions: {
          mode: "default",
          allow: ["Read", "Bash(git status*)"],
          deny: ["Bash(rm -rf*)"],
        },
      }),
    );

    const config = await loadPermissionConfigFromFile(configPath);
    expect(config.mode).toBe("default");
    expect(config.allow).toEqual(["Read", "Bash(git status*)"]);
    expect(config.deny).toEqual(["Bash(rm -rf*)"]);
  });

  test("returns empty config when file does not exist", async () => {
    const configPath = join(testDir, "nonexistent.json");
    const config = await loadPermissionConfigFromFile(configPath);
    expect(config).toEqual({});
  });

  test("returns empty config when file has no permissions key", async () => {
    const configPath = join(testDir, "settings.json");
    await writeFile(configPath, JSON.stringify({ other: "data" }));

    const config = await loadPermissionConfigFromFile(configPath);
    expect(config).toEqual({});
  });

  test("handles partial permissions config", async () => {
    const configPath = join(testDir, "settings.json");
    await writeFile(
      configPath,
      JSON.stringify({
        permissions: { allow: ["Read"] },
      }),
    );

    const config = await loadPermissionConfigFromFile(configPath);
    expect(config.allow).toEqual(["Read"]);
    expect(config.deny).toBeUndefined();
    expect(config.ask).toBeUndefined();
  });
});

// ──────────────────────────────────────────────
// savePermissionRule
// ──────────────────────────────────────────────

describe("savePermissionRule", () => {
  test("creates new config file with allow rule", async () => {
    const configPath = join(testDir, "settings.json");
    await savePermissionRule(configPath, {
      behavior: "allow",
      value: { toolName: "Bash", ruleContent: "npm test*" },
    });

    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    expect(raw.permissions.allow).toContain("Bash(npm test*)");
  });

  test("appends deny rule to existing config", async () => {
    const configPath = join(testDir, "settings.json");
    await writeFile(
      configPath,
      JSON.stringify({
        permissions: {
          allow: ["Read"],
        },
      }),
    );

    await savePermissionRule(configPath, {
      behavior: "deny",
      value: { toolName: "Bash", ruleContent: "rm -rf*" },
    });

    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    expect(raw.permissions.allow).toContain("Read");
    expect(raw.permissions.deny).toContain("Bash(rm -rf*)");
  });

  test("adds tool-only rule without parentheses", async () => {
    const configPath = join(testDir, "settings.json");
    await savePermissionRule(configPath, {
      behavior: "allow",
      value: { toolName: "Read" },
    });

    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    expect(raw.permissions.allow).toContain("Read");
  });

  test("does not duplicate existing rules", async () => {
    const configPath = join(testDir, "settings.json");
    await writeFile(
      configPath,
      JSON.stringify({
        permissions: { allow: ["Read"] },
      }),
    );

    await savePermissionRule(configPath, {
      behavior: "allow",
      value: { toolName: "Read" },
    });

    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    expect(raw.permissions.allow).toEqual(["Read"]);
  });
});

// ──────────────────────────────────────────────
// getProjectSettingsPath
// ──────────────────────────────────────────────

describe("getProjectSettingsPath", () => {
  test("returns .claude/settings.json under working directory", () => {
    const path = getProjectSettingsPath("/home/user/project");
    expect(path).toBe("/home/user/project/.claude/settings.json");
  });

  test("handles working directory with trailing slash", () => {
    const path = getProjectSettingsPath("/home/user/project/");
    // join normalizes trailing slashes
    expect(path).toContain(".claude/settings.json");
    expect(path).toMatch(/\/project\/\.claude\/settings\.json$/);
  });
});
