/**
 * Tests for SKILL.md frontmatter parser.
 * Covers: parseFrontmatter, parseSkillFrontmatter, parseSkillPaths, createSkillCommand
 */

import { describe, test, expect } from "vitest";
import {
  parseFrontmatter,
  parseSkillFrontmatter,
  parseSkillPaths,
  createSkillCommand,
} from "../../../src/skills/parser.js";

describe("parseFrontmatter", () => {
  test("parses basic frontmatter", () => {
    const content = `---
name: my-skill
description: A test skill
when_to_use: Use when testing
---
# Skill Content
Hello world`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe("my-skill");
    expect(result.frontmatter.description).toBe("A test skill");
    expect(result.frontmatter.when_to_use).toBe("Use when testing");
    expect(result.body).toBe("# Skill Content\nHello world");
  });

  test("returns empty frontmatter when no delimiters", () => {
    const content = "# Just markdown\nNo frontmatter here";
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content);
  });

  test("handles empty frontmatter block", () => {
    const content = `---
---
Body content`;
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Body content");
  });

  test("parses list values", () => {
    const content = `---
allowed-tools: [Read, Bash, Write]
---
Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter["allowed-tools"]).toEqual(["Read", "Bash", "Write"]);
  });

  test("parses boolean values", () => {
    const content = `---
user-invocable: true
disable-model-invocation: false
---
Content`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter["user-invocable"]).toBe(true);
    expect(result.frontmatter["disable-model-invocation"]).toBe(false);
  });

  test("handles unclosed frontmatter", () => {
    const content = `---
name: broken
No closing delimiter`;
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content);
  });

  test("handles numeric values", () => {
    const content = `---
version: 42
---
Content`;
    const result = parseFrontmatter(content);
    expect(result.frontmatter.version).toBe(42);
  });
});

describe("parseSkillFrontmatter", () => {
  test("maps raw frontmatter to typed fields", () => {
    const raw = {
      name: "test-skill",
      description: "A test",
      when_to_use: "Use for testing",
      "allowed-tools": ["Read", "Bash"],
      arguments: ["msg", "file"],
      model: "sonnet",
      effort: "high",
      context: "fork",
      agent: "Bash",
      "user-invocable": true,
      "disable-model-invocation": false,
    };

    const fm = parseSkillFrontmatter(raw);
    expect(fm.name).toBe("test-skill");
    expect(fm.description).toBe("A test");
    expect(fm.when_to_use).toBe("Use for testing");
    expect(fm.allowed_tools).toEqual(["Read", "Bash"]);
    expect(fm.arguments).toEqual(["msg", "file"]);
    expect(fm.model).toBe("sonnet");
    expect(fm.effort).toBe("high");
    expect(fm.context).toBe("fork");
    expect(fm.agent).toBe("Bash");
    expect(fm.user_invocable).toBe(true);
    expect(fm.disable_model_invocation).toBe(false);
  });

  test("handles missing optional fields", () => {
    const raw = { name: "minimal" };
    const fm = parseSkillFrontmatter(raw);
    expect(fm.name).toBe("minimal");
    expect(fm.description).toBeUndefined();
    expect(fm.allowed_tools).toBeUndefined();
    expect(fm.context).toBeUndefined();
  });

  test("converts string allowed-tools to array", () => {
    const raw = { "allowed-tools": "Read" };
    const fm = parseSkillFrontmatter(raw);
    expect(fm.allowed_tools).toEqual(["Read"]);
  });

  test("converts string paths to array", () => {
    const raw = { paths: "src/**/*.ts" };
    const fm = parseSkillFrontmatter(raw);
    expect(fm.paths).toEqual(["src/**/*.ts"]);
  });

  test("ignores invalid context value", () => {
    const raw = { context: "invalid" };
    const fm = parseSkillFrontmatter(raw);
    expect(fm.context).toBeUndefined();
  });
});

describe("parseSkillPaths", () => {
  test("returns undefined for undefined input", () => {
    expect(parseSkillPaths(undefined)).toBeUndefined();
  });

  test("strips trailing /** from patterns", () => {
    const result = parseSkillPaths(["src/**", "tests/**"]);
    expect(result).toEqual(["src", "tests"]);
  });

  test("returns undefined for match-all patterns", () => {
    expect(parseSkillPaths(["**"])).toBeUndefined();
    expect(parseSkillPaths(["**", "**"])).toBeUndefined();
  });

  test("filters empty patterns", () => {
    const result = parseSkillPaths(["src", "", "tests"]);
    expect(result).toEqual(["src", "tests"]);
  });

  test("handles string input", () => {
    const result = parseSkillPaths("src/**/*.ts");
    expect(result).toEqual(["src/**/*.ts"]);
  });
});

describe("createSkillCommand", () => {
  test("creates a valid SkillCommand", () => {
    const cmd = createSkillCommand({
      skillName: "test-skill",
      description: "A test",
      allowedTools: ["Read"],
      argumentNames: [],
      userInvocable: true,
      disableModelInvocation: false,
      markdownContent: "# Test\nHello",
      source: "user",
      loadedFrom: "skills",
    });

    expect(cmd.type).toBe("prompt");
    expect(cmd.name).toBe("test-skill");
    expect(cmd.description).toBe("A test");
    expect(cmd.source).toBe("user");
    expect(cmd.loadedFrom).toBe("skills");
    expect(cmd.userInvocable).toBe(true);
    expect(cmd.isHidden).toBe(false);
    expect(cmd.disableModelInvocation).toBe(false);
  });

  test("uses fallback description when empty", () => {
    const cmd = createSkillCommand({
      skillName: "my-skill",
      description: "",
      allowedTools: [],
      argumentNames: [],
      userInvocable: true,
      disableModelInvocation: false,
      markdownContent: "Content",
      source: "project",
      loadedFrom: "skills",
    });

    expect(cmd.description).toBe("Skill: my-skill");
  });

  test("sets isHidden when not user-invocable", () => {
    const cmd = createSkillCommand({
      skillName: "hidden",
      description: "Hidden skill",
      allowedTools: [],
      argumentNames: [],
      userInvocable: false,
      disableModelInvocation: false,
      markdownContent: "Content",
      source: "bundled",
      loadedFrom: "bundled",
    });

    expect(cmd.isHidden).toBe(true);
  });

  test("getPromptForCommand replaces $ARGUMENTS", async () => {
    const cmd = createSkillCommand({
      skillName: "test",
      description: "Test",
      allowedTools: [],
      argumentNames: [],
      userInvocable: true,
      disableModelInvocation: false,
      markdownContent: "Hello $ARGUMENTS!",
      source: "user",
      loadedFrom: "skills",
    });

    const blocks = await cmd.getPromptForCommand("world");
    expect(blocks[0]!.text).toBe("Hello world!");
  });

  test("getPromptForCommand prepends baseDir", async () => {
    const cmd = createSkillCommand({
      skillName: "test",
      description: "Test",
      allowedTools: [],
      argumentNames: [],
      userInvocable: true,
      disableModelInvocation: false,
      markdownContent: "Content",
      baseDir: "/path/to/skill",
      source: "project",
      loadedFrom: "skills",
    });

    const blocks = await cmd.getPromptForCommand("");
    expect(blocks[0]!.text).toContain("Base directory for this skill: /path/to/skill");
  });
});
