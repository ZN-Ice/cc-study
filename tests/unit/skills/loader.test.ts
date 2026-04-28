/**
 * Tests for skills loader integration.
 * Verifies that skills from .claude/skills/ directories are discovered and loaded.
 */

import { describe, it, expect } from "vitest";
import { loadSkillsFromDir, loadAllSkills } from "../../../src/skills/loader.js";
import { join } from "path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "cc-study-skill-test-"));
}

describe("loadSkillsFromDir", () => {
  let tempDir: string;

  it("loads a skill from a directory with SKILL.md", async () => {
    tempDir = makeTempDir();
    const skillDir = join(tempDir, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: my-skill
description: My test skill
user_invocable: true
---

# My Skill

This is my test skill content.
`,
    );

    const skills = await loadSkillsFromDir(tempDir, "project");
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("my-skill");
    expect(skills[0].description).toBe("My test skill");
    expect(skills[0].userInvocable).toBe(true);
    expect(skills[0].source).toBe("project");

    const prompt = await skills[0].getPromptForCommand("hello");
    expect(prompt[0].text).toContain("my test skill content");
    expect(prompt[0].text).toContain("Base directory");

    rmSync(tempDir, { recursive: true });
  });

  it("skips directories without SKILL.md", async () => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, "empty-dir"), { recursive: true });

    const skills = await loadSkillsFromDir(tempDir, "user");
    expect(skills).toHaveLength(0);

    rmSync(tempDir, { recursive: true });
  });

  it("returns empty for non-existent directory", async () => {
    const skills = await loadSkillsFromDir("/nonexistent/path", "user");
    expect(skills).toHaveLength(0);
  });

  it("handles malformed SKILL.md gracefully", async () => {
    tempDir = makeTempDir();
    const skillDir = join(tempDir, "bad-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "just some text without frontmatter");

    const skills = await loadSkillsFromDir(tempDir, "project");
    // Should still load - parser handles missing frontmatter gracefully
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("bad-skill");

    rmSync(tempDir, { recursive: true });
  });
});

describe("loadAllSkills", () => {
  it("loads from project skills dir", async () => {
    const tempDir = makeTempDir();
    const skillDir = join(tempDir, "proj-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
description: Project skill
---
Content here`,
    );

    const result = await loadAllSkills({ projectSkillsDirs: [tempDir] });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("proj-skill");

    rmSync(tempDir, { recursive: true });
  });

  it("deduplicates by canonical path", async () => {
    const tempDir = makeTempDir();
    const skillDir = join(tempDir, "dup-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
description: Dup
---
Content`,
    );

    // Same directory listed twice
    const result = await loadAllSkills({
      projectSkillsDirs: [tempDir, tempDir],
    });
    expect(result.skills).toHaveLength(1);

    rmSync(tempDir, { recursive: true });
  });

  it("separates conditional skills (with paths)", async () => {
    const tempDir = makeTempDir();

    // Unconditional skill
    const uncondDir = join(tempDir, "uncond");
    mkdirSync(uncondDir, { recursive: true });
    writeFileSync(join(uncondDir, "SKILL.md"), `---\ndescription: Unconditional\n---\nNo paths`);

    // Conditional skill (with paths)
    const condDir = join(tempDir, "cond");
    mkdirSync(condDir, { recursive: true });
    writeFileSync(
      join(condDir, "SKILL.md"),
      `---
description: Conditional
paths: [src/**/*.ts]
---
Has paths`,
    );

    const result = await loadAllSkills({ projectSkillsDirs: [tempDir] });
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("uncond");
    expect(result.conditionalSkills).toHaveLength(1);
    expect(result.conditionalSkills[0].name).toBe("cond");

    rmSync(tempDir, { recursive: true });
  });

  it("works with no directories", async () => {
    const result = await loadAllSkills({});
    expect(result.skills).toHaveLength(0);
    expect(result.conditionalSkills).toHaveLength(0);
  });

  it("loads real project test-skill from .claude/skills", async () => {
    const projectRoot = join(process.cwd(), ".claude", "skills");
    const result = await loadAllSkills({ projectSkillsDirs: [projectRoot] });
    expect(result.skills.length).toBeGreaterThanOrEqual(1);

    const testSkill = result.skills.find((s) => s.name === "test-skill");
    expect(testSkill).toBeDefined();
    expect(testSkill!.description).toContain("test skill");
    expect(testSkill!.userInvocable).toBe(true);
  });
});
