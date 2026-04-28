/**
 * SkillTool - allows the LLM to invoke skills by name.
 * Reference: free-code/src/tools/SkillTool/SkillTool.ts
 *
 * Lifecycle:
 * 1. validateInput: check skill name, existence, disableModelInvocation
 * 2. checkPermissions: deny/allow rules, safe properties auto-allow, default ask
 * 3. execute: inline (getPromptForCommand) or fork (sub-agent)
 */

import { z } from "zod";
import type { Tool, ToolResult, ValidationResult } from "../types.js";
import type { PermissionDecision } from "../../permissions/types.js";
import type { SkillCommand } from "../../skills/types.js";
import { recordSkillUsage } from "../../skills/usageTracking.js";
import { SKILL_TOOL_NAME } from "./constants.js";
import { getSkillToolDescription, formatSkillsWithinBudget } from "./prompt.js";

// ──────────────────────────────────────────────
// Input Schema
// ──────────────────────────────────────────────

const skillInputSchema = z.strictObject({
  skill: z.string().describe("The skill name. E.g., 'review', 'simplify'"),
  args: z.string().optional().describe("Optional arguments for the skill"),
});

// ──────────────────────────────────────────────
// Safe Properties Allowlist
// ──────────────────────────────────────────────

const SAFE_SKILL_PROPERTIES = new Set([
  "type", "name", "description", "hasUserSpecifiedDescription",
  "allowedTools", "argumentHint", "argNames", "whenToUse",
  "model", "effort", "source", "loadedFrom", "disableModelInvocation",
  "userInvocable", "context", "agent", "paths", "isHidden",
  "progressMessage", "contentLength", "skillRoot", "getPromptForCommand",
  "isEnabled",
]);

function skillHasOnlySafeProperties(skill: SkillCommand): boolean {
  for (const key of Object.keys(skill)) {
    if (SAFE_SKILL_PROPERTIES.has(key)) continue;
    const value = (skill as unknown as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0) continue;
    return false;
  }
  return true;
}

// ──────────────────────────────────────────────
// Helper: find skill from commands
// ──────────────────────────────────────────────

type SkillLookup = (name: string) => SkillCommand | undefined;

let skillLookupFn: SkillLookup = () => undefined;

/** Module-level skills array for dynamic description generation */
let allSkills: SkillCommand[] = [];

/**
 * Set the skill lookup function and skill list (called during REPL initialization).
 */
export function setSkillLookup(fn: SkillLookup, skills: SkillCommand[] = []): void {
  skillLookupFn = fn;
  allSkills = skills;
}

/** Get current skill list (for testing/debugging) */
export function getSkillList(): SkillCommand[] {
  return allSkills;
}

function normalizeSkillName(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("/") ? trimmed.substring(1) : trimmed;
}

/**
 * Check if a rule matches a command name.
 * Supports exact match and prefix wildcard (e.g., "review:*").
 */
function ruleMatchesSkill(ruleContent: string | undefined, commandName: string): boolean {
  if (!ruleContent) return false;
  const normalized = ruleContent.startsWith("/")
    ? ruleContent.substring(1)
    : ruleContent;

  if (normalized === commandName) return true;
  if (normalized.endsWith(":*")) {
    const prefix = normalized.slice(0, -2);
    return commandName.startsWith(prefix);
  }
  return false;
}

// ──────────────────────────────────────────────
// SkillTool Definition
// ──────────────────────────────────────────────

export const SkillTool: Tool<typeof skillInputSchema> = {
  name: SKILL_TOOL_NAME,
  inputSchema: skillInputSchema,

  get description(): string {
    // Dynamically build description with current skill list
    const baseDesc = getSkillToolDescription();
    const skillList = formatSkillsWithinBudget(allSkills);
    if (!skillList) {
      return baseDesc;
    }
    return `${baseDesc}\n\n## Available skills\n${skillList}`;
  },

  async validateInput(input): Promise<ValidationResult> {
    const trimmed = input.skill?.trim();
    if (!trimmed) {
      return { ok: false, error: "Invalid skill format: empty name" };
    }

    const commandName = normalizeSkillName(trimmed);
    const command = skillLookupFn(commandName);

    if (!command) {
      return { ok: false, error: `Unknown skill: ${commandName}` };
    }

    if (command.disableModelInvocation) {
      return {
        ok: false,
        error: `Skill ${commandName} cannot be invoked by models (disable-model-invocation)`,
      };
    }

    return { ok: true };
  },

  async checkPermissions(
    input,
    _context,
    permContext,
  ): Promise<PermissionDecision | undefined> {
    const commandName = normalizeSkillName(input.skill.trim());
    const command = skillLookupFn(commandName);

    // Check deny rules
    const denyRules = permContext.denyRules ?? [];
    for (const rule of denyRules) {
      if (ruleMatchesSkill(rule.value?.ruleContent, commandName)) {
        return {
          behavior: "deny",
          message: `Skill execution blocked by permission rules`,
        };
      }
    }

    // Check allow rules
    const allowRules = permContext.allowRules ?? [];
    for (const rule of allowRules) {
      if (ruleMatchesSkill(rule.value?.ruleContent, commandName)) {
        return { behavior: "allow" };
      }
    }

    // Auto-allow safe skills
    if (command && skillHasOnlySafeProperties(command)) {
      return { behavior: "allow" };
    }

    // Default: ask
    return { behavior: "ask", message: `Execute skill: ${commandName}` };
  },

  async execute(input, context): Promise<ToolResult> {
    const commandName = normalizeSkillName(input.skill.trim());
    const args = input.args || "";
    const command = skillLookupFn(commandName);

    if (!command) {
      return { output: `Unknown skill: ${commandName}`, error: true };
    }

    // Track usage
    recordSkillUsage(commandName);

    // Get prompt content
    const blocks = await command.getPromptForCommand(args, {
      abortSignal: context.abortSignal,
      workingDirectory: context.workingDirectory,
    });

    const content = blocks.map((b) => b.text).join("\n");

    return {
      output: content,
      metadata: {
        skillName: commandName,
        allowedTools: command.allowedTools,
        model: command.model,
        executionContext: command.context || "inline",
      },
    };
  },
};
