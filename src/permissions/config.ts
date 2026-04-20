/**
 * Permission config file read/write.
 *
 * Handles loading and saving permission rules to settings.json files.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PermissionConfig, PermissionRuleValue, PermissionBehavior } from "./types.js";

/**
 * Load permission config from a settings.json file.
 * Returns empty config if file doesn't exist or has no permissions key.
 */
export async function loadPermissionConfigFromFile(
  filePath: string,
): Promise<PermissionConfig> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const json = JSON.parse(raw) as { permissions?: PermissionConfig };
    return json.permissions ?? {};
  } catch {
    return {};
  }
}

/**
 * Format a rule value to a config string.
 * "ToolName" or "ToolName(pattern)"
 */
function formatRuleString(value: PermissionRuleValue): string {
  if (value.ruleContent) {
    return `${value.toolName}(${value.ruleContent})`;
  }
  return value.toolName;
}

/**
 * Save a permission rule to a settings.json file.
 * Creates the file if it doesn't exist. Appends to existing rules.
 * Does not duplicate existing rules.
 */
export async function savePermissionRule(
  filePath: string,
  rule: { behavior: PermissionBehavior; value: PermissionRuleValue },
): Promise<void> {
  // Ensure parent directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Load existing config
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(filePath, "utf-8");
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // File doesn't exist, start fresh
  }

  const permissions = (existing.permissions ?? {}) as Record<string, string[]>;
  const key = rule.behavior as string;
  const rules = (permissions[key] ?? []) as string[];
  const ruleStr = formatRuleString(rule.value);

  // Don't duplicate
  if (!rules.includes(ruleStr)) {
    rules.push(ruleStr);
  }

  permissions[key] = rules;
  existing.permissions = permissions;

  await writeFile(filePath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
}
