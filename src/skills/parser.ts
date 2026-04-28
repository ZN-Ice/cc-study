/**
 * SKILL.md frontmatter parser.
 * Reference: free-code/src/skills/loadSkillsDir.ts (parseSkillFrontmatterFields)
 *
 * Parses YAML-like frontmatter from SKILL.md files.
 * Supports core fields: name, description, when_to_use, allowed-tools, etc.
 */

import type {
  SkillFrontmatter,
  SkillCommand,
  SkillSource,
  LoadedFrom,
} from "./types.js";

// ──────────────────────────────────────────────
// Frontmatter Parsing
// ──────────────────────────────────────────────

const FRONTMATTER_DELIMITER = "---";

/**
 * Parse YAML-like frontmatter from markdown content.
 * Returns raw key-value pairs as a simple object.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const trimmed = content.trimStart();

  if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) {
    return { frontmatter: {}, body: content };
  }

  const firstDelimEnd = trimmed.indexOf("\n", 0);
  if (firstDelimEnd === -1) {
    return { frontmatter: {}, body: content };
  }

  const closingIndex = trimmed.indexOf(
    FRONTMATTER_DELIMITER,
    firstDelimEnd + 1,
  );
  if (closingIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlBlock = trimmed.slice(firstDelimEnd + 1, closingIndex).trim();
  const body = trimmed.slice(closingIndex + FRONTMATTER_DELIMITER.length).trimStart();

  const frontmatter: Record<string, unknown> = {};

  for (const line of yamlBlock.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1).trim();

    if (rawValue === "") continue;

    // Handle list values [a, b, c]
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      frontmatter[key] = rawValue
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    // Handle boolean values
    else if (rawValue === "true") {
      frontmatter[key] = true;
    } else if (rawValue === "false") {
      frontmatter[key] = false;
    }
    // Handle numeric values
    else if (/^\d+$/.test(rawValue)) {
      frontmatter[key] = parseInt(rawValue, 10);
    } else {
      frontmatter[key] = rawValue;
    }
  }

  return { frontmatter, body };
}

/**
 * Parse and normalize frontmatter fields into SkillFrontmatter.
 */
export function parseSkillFrontmatter(
  rawFrontmatter: Record<string, unknown>,
): SkillFrontmatter {
  const fm: SkillFrontmatter = {};

  if (rawFrontmatter.name != null) fm.name = String(rawFrontmatter.name);
  if (rawFrontmatter.description != null)
    fm.description = String(rawFrontmatter.description);
  if (rawFrontmatter.when_to_use != null)
    fm.when_to_use = String(rawFrontmatter.when_to_use);
  if (rawFrontmatter.argument_hint != null)
    fm.argument_hint = String(rawFrontmatter.argument_hint);
  if (rawFrontmatter.model != null) fm.model = String(rawFrontmatter.model);
  if (rawFrontmatter.effort != null) fm.effort = String(rawFrontmatter.effort);
  if (rawFrontmatter.agent != null) fm.agent = String(rawFrontmatter.agent);

  // allowed_tools: string or string[]
  if (rawFrontmatter["allowed-tools"] != null) {
    const val = rawFrontmatter["allowed-tools"];
    fm.allowed_tools = Array.isArray(val)
      ? val.map(String)
      : [String(val)];
  }

  // arguments: string or string[]
  if (rawFrontmatter.arguments != null) {
    const val = rawFrontmatter.arguments;
    fm.arguments = Array.isArray(val) ? val.map(String) : [String(val)];
  }

  // paths: string or string[]
  if (rawFrontmatter.paths != null) {
    const val = rawFrontmatter.paths;
    fm.paths = Array.isArray(val) ? val : [String(val)];
  }

  // context: inline | fork
  if (
    rawFrontmatter.context === "inline" ||
    rawFrontmatter.context === "fork"
  ) {
    fm.context = rawFrontmatter.context;
  }

  // booleans
  if (rawFrontmatter["user-invocable"] != null)
    fm.user_invocable = Boolean(rawFrontmatter["user-invocable"]);
  if (rawFrontmatter["disable-model-invocation"] != null)
    fm.disable_model_invocation = Boolean(
      rawFrontmatter["disable-model-invocation"],
    );

  return fm;
}

/**
 * Parse paths from frontmatter, normalizing glob patterns.
 * Returns undefined if no paths or all match-all patterns.
 */
export function parseSkillPaths(
  paths: string | string[] | undefined,
): string[] | undefined {
  if (!paths) return undefined;

  const arr = Array.isArray(paths) ? paths : [paths];
  const normalized = arr
    .map((p) => (p.endsWith("/**") ? p.slice(0, -3) : p))
    .filter((p) => p.length > 0);

  if (normalized.length === 0 || normalized.every((p) => p === "**")) {
    return undefined;
  }

  return normalized;
}

// ──────────────────────────────────────────────
// Skill Command Factory
// ──────────────────────────────────────────────

/**
 * Create a SkillCommand from a parsed SKILL.md file.
 */
export function createSkillCommand(params: {
  skillName: string;
  displayName?: string;
  description: string;
  whenToUse?: string;
  allowedTools: string[];
  argumentHint?: string;
  argumentNames: string[];
  model?: string;
  effort?: string;
  executionContext?: "inline" | "fork";
  agent?: string;
  paths?: string[];
  userInvocable: boolean;
  disableModelInvocation: boolean;
  markdownContent: string;
  baseDir?: string;
  source: SkillSource;
  loadedFrom: LoadedFrom;
}): SkillCommand {
  const {
    skillName,
    description,
    whenToUse,
    allowedTools,
    argumentHint,
    argumentNames,
    model,
    effort,
    executionContext,
    agent,
    paths,
    userInvocable,
    disableModelInvocation,
    markdownContent,
    baseDir,
    source,
    loadedFrom,
  } = params;

  return {
    type: "prompt",
    name: skillName,
    description: description || `Skill: ${skillName}`,
    hasUserSpecifiedDescription: !!description,
    allowedTools,
    argumentHint,
    argNames: argumentNames.length > 0 ? argumentNames : undefined,
    whenToUse,
    model,
    disableModelInvocation,
    userInvocable,
    context: executionContext,
    agent,
    effort,
    paths,
    source,
    loadedFrom,
    isHidden: !userInvocable,
    progressMessage: "running",
    contentLength: markdownContent.length,
    skillRoot: baseDir,
    async getPromptForCommand(args: string, _context?: { abortSignal?: AbortSignal; workingDirectory?: string }) {
      let content = baseDir
        ? `Base directory for this skill: ${baseDir}\n\n${markdownContent}`
        : markdownContent;

      // Replace $ARGUMENTS with provided args
      if (args) {
        content = content.replace(/\$ARGUMENTS/g, args);
      }

      return [{ type: "text", text: content }];
    },
  };
}
