/**
 * SkillTool prompt generation with budget management.
 * Reference: free-code/src/tools/SkillTool/prompt.ts
 *
 * Skills listing gets 1% of context window, with per-entry hard cap.
 */

import type { SkillCommand } from "../../skills/types.js";

// 1% of context window (in characters)
export const SKILL_BUDGET_CONTEXT_PERCENT = 0.01;
export const CHARS_PER_TOKEN = 4;
export const DEFAULT_CHAR_BUDGET = 8000; // 1% of 200k × 4
export const MAX_LISTING_DESC_CHARS = 250;
const MIN_DESC_LENGTH = 20;

export function getCharBudget(contextWindowTokens?: number): number {
  if (contextWindowTokens) {
    return Math.floor(
      contextWindowTokens * CHARS_PER_TOKEN * SKILL_BUDGET_CONTEXT_PERCENT,
    );
  }
  return DEFAULT_CHAR_BUDGET;
}

function getCommandDescription(skill: SkillCommand): string {
  const desc = skill.whenToUse
    ? `${skill.description} - ${skill.whenToUse}`
    : skill.description;
  return desc.length > MAX_LISTING_DESC_CHARS
    ? desc.slice(0, MAX_LISTING_DESC_CHARS - 1) + "…"
    : desc;
}

function formatSkillEntry(skill: SkillCommand): string {
  return `- ${skill.name}: ${getCommandDescription(skill)}`;
}

function truncateDescription(desc: string, maxLen: number): string {
  if (desc.length <= maxLen) return desc;
  return desc.slice(0, maxLen - 1) + "…";
}

/**
 * Format skills list within character budget.
 * Bundled skills always get full descriptions.
 */
export function formatSkillsWithinBudget(
  skills: SkillCommand[],
  contextWindowTokens?: number,
): string {
  if (skills.length === 0) return "";

  const budget = getCharBudget(contextWindowTokens);

  // Try full descriptions first
  const fullEntries = skills.map((s) => ({
    skill: s,
    full: formatSkillEntry(s),
  }));
  const fullTotal = fullEntries.reduce(
    (sum, e) => sum + e.full.length + 1,
    -1,
  );

  if (fullTotal <= budget) {
    return fullEntries.map((e) => e.full).join("\n");
  }

  // Separate bundled (never truncated) from rest
  const bundledIndices = new Set<number>();
  const restSkills: SkillCommand[] = [];
  for (let i = 0; i < skills.length; i++) {
    if (skills[i]!.source === "bundled") {
      bundledIndices.add(i);
    } else {
      restSkills.push(skills[i]!);
    }
  }

  const bundledChars = fullEntries.reduce(
    (sum, e, i) => (bundledIndices.has(i) ? sum + e.full.length + 1 : sum),
    0,
  );
  const remainingBudget = budget - bundledChars;

  if (restSkills.length === 0) {
    return fullEntries.map((e) => e.full).join("\n");
  }

  const restNameOverhead = restSkills.reduce(
    (sum, s) => sum + s.name.length + 4,
    -(restSkills.length - 1),
  );
  const availableForDescs = remainingBudget - restNameOverhead;
  const maxDescLen = Math.floor(availableForDescs / restSkills.length);

  if (maxDescLen < MIN_DESC_LENGTH) {
    // Names only for non-bundled
    return skills
      .map((s, i) =>
        bundledIndices.has(i) ? fullEntries[i]!.full : `- ${s.name}`,
      )
      .join("\n");
  }

  // Truncate non-bundled descriptions
  return skills
    .map((s, i) => {
      if (bundledIndices.has(i)) return fullEntries[i]!.full;
      const desc = getCommandDescription(s);
      return `- ${s.name}: ${truncateDescription(desc, maxDescLen)}`;
    })
    .join("\n");
}

/**
 * Get the SkillTool description prompt.
 */
export function getSkillToolDescription(): string {
  return `Execute a named skill within the main conversation.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - skill: "review" - invoke the review skill
  - skill: "simplify", args: "focus on performance" - invoke with arguments

Important:
- Available skills are listed in system messages
- When a skill matches the user's request, invoke the relevant skill BEFORE generating any other response
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)`;
}
