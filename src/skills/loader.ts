/**
 * Skills directory loader.
 * Reference: free-code/src/skills/loadSkillsDir.ts
 *
 * Scans multiple skill directories, parses SKILL.md files,
 * deduplicates by resolved path, and separates conditional skills.
 */

import { realpath } from "fs/promises";
import { join } from "path";
import {
  parseFrontmatter,
  parseSkillFrontmatter,
  parseSkillPaths,
  createSkillCommand,
} from "./parser.js";
import type { SkillCommand } from "./types.js";

// ──────────────────────────────────────────────
// Directory Loading
// ──────────────────────────────────────────────

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    const { readdir } = await import("fs/promises");
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    const { readFile } = await import("fs/promises");
    return await readFile(filePath, { encoding: "utf-8" });
  } catch {
    return null;
  }
}

/**
 * Load skills from a single directory.
 * Only supports directory format: skill-name/SKILL.md
 */
export async function loadSkillsFromDir(
  basePath: string,
  source: "user" | "project",
): Promise<SkillCommand[]> {
  const entries = await readDirSafe(basePath);
  const skills: SkillCommand[] = [];

  for (const entry of entries) {
    const skillDirPath = join(basePath, entry);
    const skillFilePath = join(skillDirPath, "SKILL.md");

    const content = await readFileSafe(skillFilePath);
    if (content === null) continue;

    try {
      const { frontmatter, body } = parseFrontmatter(content);
      const fm = parseSkillFrontmatter(frontmatter);

      const skill = createSkillCommand({
        skillName: entry,
        displayName: fm.name,
        description: fm.description || `Skill: ${entry}`,
        whenToUse: fm.when_to_use,
        allowedTools: fm.allowed_tools || [],
        argumentHint: fm.argument_hint,
        argumentNames: fm.arguments || [],
        model: fm.model,
        effort: fm.effort,
        executionContext: fm.context,
        agent: fm.agent,
        paths: parseSkillPaths(fm.paths),
        userInvocable: fm.user_invocable !== false,
        disableModelInvocation: fm.disable_model_invocation === true,
        markdownContent: body,
        baseDir: skillDirPath,
        source,
        loadedFrom: "skills",
      });

      skills.push(skill);
    } catch {
      // Skip malformed skills silently
    }
  }

  return skills;
}

/**
 * Load all skills from multiple directories, with deduplication.
 */
export async function loadAllSkills(directories: {
  userSkillsDir?: string;
  projectSkillsDirs?: string[];
}): Promise<{
  skills: SkillCommand[];
  conditionalSkills: SkillCommand[];
}> {
  const allSkills: { skill: SkillCommand; filePath: string }[] = [];

  // Load user skills
  if (directories.userSkillsDir) {
    const userSkills = await loadSkillsFromDir(
      directories.userSkillsDir,
      "user",
    );
    for (const skill of userSkills) {
      allSkills.push({
        skill,
        filePath: join(directories.userSkillsDir, skill.name, "SKILL.md"),
      });
    }
  }

  // Load project skills
  if (directories.projectSkillsDirs) {
    for (const dir of directories.projectSkillsDirs) {
      const projectSkills = await loadSkillsFromDir(dir, "project");
      for (const skill of projectSkills) {
        allSkills.push({
          skill,
          filePath: join(dir, skill.name, "SKILL.md"),
        });
      }
    }
  }

  // Deduplicate by resolved canonical path
  const seenPaths = new Set<string>();
  const deduplicated: SkillCommand[] = [];
  const conditional: SkillCommand[] = [];

  for (const { skill, filePath } of allSkills) {
    let canonicalPath: string | null = null;
    try {
      canonicalPath = await realpath(filePath);
    } catch {
      // File might not resolve, use as-is
    }

    const identityKey = canonicalPath || filePath;
    if (seenPaths.has(identityKey)) continue;
    seenPaths.add(identityKey);

    // Separate conditional skills (with paths) from unconditional
    if (skill.paths && skill.paths.length > 0) {
      conditional.push(skill);
    } else {
      deduplicated.push(skill);
    }
  }

  return { skills: deduplicated, conditionalSkills: conditional };
}
