/**
 * Permission rule matching engine.
 *
 * References: free-code/src/permissions.ts
 *
 * Provides functions for matching tools and content against permission rules.
 */

import type {
  PermissionRule,
  ToolPermissionContext,
} from "./types.js";
import { minimatch } from "minimatch";

/**
 * Check if a tool name matches a rule (tool-level, no content matching).
 * Only matches when the rule has no ruleContent (i.e., applies to the entire tool).
 */
export function toolMatchesRule(
  toolName: string,
  rule: PermissionRule,
): boolean {
  // Rule with content doesn't match at tool level
  if (rule.value.ruleContent !== undefined) {
    return false;
  }
  return rule.value.toolName === toolName;
}

/**
 * Check if content matches a rule's content pattern using glob matching.
 * Only applicable when the rule has ruleContent.
 */
export function contentMatchesRule(
  content: string,
  rule: PermissionRule,
): boolean {
  if (!rule.value.ruleContent) {
    return false;
  }
  return minimatch(content, rule.value.ruleContent);
}

/**
 * Get the first deny rule that matches a tool name.
 */
export function getDenyRuleForTool(
  context: ToolPermissionContext,
  toolName: string,
): PermissionRule | null {
  for (const rule of context.denyRules) {
    if (toolMatchesRule(toolName, rule)) {
      return rule;
    }
  }
  return null;
}

/**
 * Get the first ask rule that matches a tool name.
 */
export function getAskRuleForTool(
  context: ToolPermissionContext,
  toolName: string,
): PermissionRule | null {
  for (const rule of context.askRules) {
    if (toolMatchesRule(toolName, rule)) {
      return rule;
    }
  }
  return null;
}

/**
 * Get the first allow rule that matches a tool.
 * If the rule has content, also checks content against the provided inputContent.
 */
export function getAllowRuleForTool(
  context: ToolPermissionContext,
  toolName: string,
  inputContent?: string,
): PermissionRule | null {
  for (const rule of context.allowRules) {
    // Tool-level rule (no content)
    if (toolMatchesRule(toolName, rule)) {
      return rule;
    }
    // Content-specific rule: tool name matches AND content matches
    if (
      rule.value.toolName === toolName &&
      rule.value.ruleContent !== undefined &&
      inputContent !== undefined &&
      contentMatchesRule(inputContent, rule)
    ) {
      return rule;
    }
  }
  return null;
}
