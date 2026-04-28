/**
 * Skills system type definitions.
 * Reference: free-code/src/skills/loadSkillsDir.ts, free-code/src/types/command.ts
 */

import type { ContentBlockParam } from "../commands/types.js";
import type { HookConfig } from "../hooks/types.js";

// ──────────────────────────────────────────────
// Skill Setting Source
// ──────────────────────────────────────────────

export type SkillSource =
  | "user"        // ~/.claude/skills/
  | "project"     // .claude/skills/
  | "bundled"     // Programmatic registration
  | "mcp";        // MCP server

export type LoadedFrom =
  | "skills"
  | "bundled"
  | "mcp"
  | "commands_DEPRECATED";

// ──────────────────────────────────────────────
// SKILL.md Frontmatter
// ──────────────────────────────────────────────

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  when_to_use?: string;
  allowed_tools?: string[];
  argument_hint?: string;
  arguments?: string[];
  model?: string;
  effort?: string;
  context?: "inline" | "fork";
  agent?: string;
  paths?: string | string[];
  user_invocable?: boolean;
  disable_model_invocation?: boolean;
  hooks?: HookConfig;
}

// ──────────────────────────────────────────────
// Parsed Skill
// ──────────────────────────────────────────────

export interface ParsedSkill {
  name: string;
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
  hooks?: HookConfig;
  content: string;
  baseDir?: string;
  source: SkillSource;
  loadedFrom: LoadedFrom;
}

// ──────────────────────────────────────────────
// Bundled Skill Definition
// ──────────────────────────────────────────────

export interface BundledSkillDefinition {
  name: string;
  description: string;
  whenToUse?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  isEnabled?: () => boolean;
  hooks?: HookConfig;
  getPromptForCommand(
    args: string,
  ): Promise<ContentBlockParam[]>;
}

// ──────────────────────────────────────────────
// Skill Command (extends CommandBase as PromptCommand)
// ──────────────────────────────────────────────

export interface SkillCommand {
  type: "prompt";
  name: string;
  description: string;
  hasUserSpecifiedDescription?: boolean;
  allowedTools?: string[];
  argumentHint?: string;
  argNames?: string[];
  whenToUse?: string;
  model?: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  context?: "inline" | "fork";
  agent?: string;
  effort?: string;
  paths?: string[];
  source: SkillSource;
  loadedFrom: LoadedFrom;
  hooks?: HookConfig;
  isHidden: boolean;
  progressMessage: string;
  contentLength: number;
  skillRoot?: string;
  isEnabled?: () => boolean;
  getPromptForCommand(
    args: string,
    context?: { abortSignal?: AbortSignal; workingDirectory?: string },
  ): Promise<ContentBlockParam[]>;
}

// ──────────────────────────────────────────────
// Usage Tracking
// ──────────────────────────────────────────────

export interface SkillUsageEntry {
  usageCount: number;
  lastUsedAt: number;
}

export type SkillUsageMap = Record<string, SkillUsageEntry>;
