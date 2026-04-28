/**
 * Skill usage tracking for ranking autocomplete suggestions.
 * Reference: free-code/src/utils/suggestions/skillUsageTracking.ts
 *
 * Uses exponential decay with 7-day half-life for recency weighting.
 */

import type { SkillUsageMap } from "./types.js";

const HALF_LIFE_DAYS = 7;
const MIN_RECENCY_FACTOR = 0.1;

// In-memory usage store (simplified - free-code uses global config persistence)
const usageStore: SkillUsageMap = {};

/**
 * Record a skill usage event.
 */
export function recordSkillUsage(skillName: string): void {
  const existing = usageStore[skillName];
  usageStore[skillName] = {
    usageCount: (existing?.usageCount ?? 0) + 1,
    lastUsedAt: Date.now(),
  };
}

/**
 * Get usage score for a skill.
 * Uses exponential decay: half-life of 7 days.
 */
export function getSkillUsageScore(skillName: string): number {
  const usage = usageStore[skillName];
  if (!usage) return 0;

  const daysSinceUse =
    (Date.now() - usage.lastUsedAt) / (1000 * 60 * 60 * 24);
  const recencyFactor = Math.pow(0.5, daysSinceUse / HALF_LIFE_DAYS);

  return usage.usageCount * Math.max(recencyFactor, MIN_RECENCY_FACTOR);
}

/**
 * Sort skills by usage score (most used first).
 */
export function sortByUsage(skills: string[]): string[] {
  return [...skills].sort(
    (a, b) => getSkillUsageScore(b) - getSkillUsageScore(a),
  );
}

/**
 * Get the raw usage map (for testing/persistence).
 */
export function getUsageMap(): SkillUsageMap {
  return { ...usageStore };
}

/**
 * Clear usage data (for testing).
 */
export function clearUsageData(): void {
  for (const key of Object.keys(usageStore)) {
    delete usageStore[key];
  }
}
