/**
 * Bundled skills registry.
 * Reference: free-code/src/skills/bundledSkills.ts
 *
 * Programmatic registration of skills that ship with the CLI.
 */

import type { BundledSkillDefinition, SkillCommand } from "./types.js";

const bundledSkills: SkillCommand[] = [];

/**
 * Register a bundled skill at startup.
 */
export function registerBundledSkill(
  definition: BundledSkillDefinition,
): void {
  const command: SkillCommand = {
    type: "prompt",
    name: definition.name,
    description: definition.description,
    hasUserSpecifiedDescription: true,
    allowedTools: definition.allowedTools ?? [],
    argumentHint: definition.argumentHint,
    whenToUse: definition.whenToUse,
    model: definition.model,
    disableModelInvocation: definition.disableModelInvocation ?? false,
    userInvocable: definition.userInvocable ?? true,
    source: "bundled",
    loadedFrom: "bundled",
    hooks: definition.hooks,
    isHidden: !(definition.userInvocable ?? true),
    progressMessage: "running",
    contentLength: 0,
    isEnabled: definition.isEnabled,
    async getPromptForCommand(args: string, _context?: { abortSignal?: AbortSignal; workingDirectory?: string }) {
      return definition.getPromptForCommand(args);
    },
  };

  bundledSkills.push(command);
}

/**
 * Get all registered bundled skills.
 */
export function getBundledSkills(): SkillCommand[] {
  return bundledSkills.filter((s) => s.isEnabled?.() ?? true);
}

/**
 * Get all bundled skills including disabled ones.
 */
export function getAllBundledSkills(): SkillCommand[] {
  return [...bundledSkills];
}

/**
 * Clear bundled skills registry (for testing).
 */
export function clearBundledSkills(): void {
  bundledSkills.length = 0;
}
