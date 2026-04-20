/**
 * Permission manager: orchestrates permission checks for tool execution.
 *
 * References: free-code/src/permissions.ts (hasPermissionsToUseTool)
 *
 * Simplified decision chain:
 * 1. deny rules → deny
 * 2. ask rules → ask
 * 3. tool.checkPermissions() → deny/ask/allow
 * 4. bypassPermissions mode → allow
 * 5. plan mode + isSearchOrRead → allow
 * 6. allow rules → allow
 * 7. default → ask
 */

import type {
  PermissionConfig,
  PermissionDecision,
  PermissionMode,
  PermissionRule,
  PermissionRuleValue,
  ToolPermissionContext,
} from "./types.js";
import type { Tool, ToolContext } from "../tools/types.js";
import {
  getDenyRuleForTool,
  getAskRuleForTool,
  getAllowRuleForTool,
  contentMatchesRule,
} from "./rules.js";

export class PermissionManager {
  private context: ToolPermissionContext;

  constructor(mode: PermissionMode = "default") {
    this.context = {
      mode,
      allowRules: [],
      denyRules: [],
      askRules: [],
    };
  }

  /** Get the current permission context */
  getContext(): ToolPermissionContext {
    return this.context;
  }

  /** Add a rule to the appropriate rules list */
  addRule(rule: PermissionRule): void {
    switch (rule.behavior) {
      case "allow":
        this.context.allowRules.push(rule);
        break;
      case "deny":
        this.context.denyRules.push(rule);
        break;
      case "ask":
        this.context.askRules.push(rule);
        break;
    }
  }

  /**
   * Load rules from a config object (parsed from settings.json).
   *
   * Config strings format: "ToolName" or "ToolName(pattern*)"
   */
  loadFromConfig(
    config: PermissionConfig,
    source: PermissionRule["source"],
  ): void {
    if (config.mode) {
      this.context = { ...this.context, mode: config.mode };
    }

    for (const str of config.allow ?? []) {
      const value = parseRuleString(str);
      this.addRule({ source, behavior: "allow", value });
    }
    for (const str of config.deny ?? []) {
      const value = parseRuleString(str);
      this.addRule({ source, behavior: "deny", value });
    }
    for (const str of config.ask ?? []) {
      const value = parseRuleString(str);
      this.addRule({ source, behavior: "ask", value });
    }
  }

  /**
   * Core permission check.
   *
   * Follows the decision chain described in the file header.
   * Returns a PermissionDecision indicating whether to allow, deny, or ask the user.
   */
  async check(
    tool: Tool,
    input: Record<string, unknown>,
    toolContext: ToolContext,
  ): Promise<PermissionDecision> {
    const toolName = tool.name;
    const inputContent = extractInputContent(tool, input);

    // Step 1: Deny rules (highest priority)
    const denyRule = getDenyRuleForTool(this.context, toolName);
    if (denyRule) {
      return {
        behavior: "deny",
        message: `Tool "${toolName}" is denied by rule`,
        reason: { type: "rule", rule: denyRule },
      };
    }

    // Also check content-specific deny rules
    const contentDenyRule = this.context.denyRules.find(
      (r) =>
        r.value.toolName === toolName &&
        r.value.ruleContent !== undefined &&
        inputContent !== undefined &&
        contentMatchesRule(inputContent, r),
    );
    if (contentDenyRule) {
      return {
        behavior: "deny",
        message: `Tool "${toolName}" is denied for "${inputContent}" by rule`,
        reason: { type: "rule", rule: contentDenyRule },
      };
    }

    // Step 2: Ask rules
    const askRule = getAskRuleForTool(this.context, toolName);
    if (askRule) {
      return {
        behavior: "ask",
        message: `Tool "${toolName}" requires permission`,
        reason: { type: "rule", rule: askRule },
      };
    }

    // Step 3: Tool-level checkPermissions
    if (tool.checkPermissions) {
      const toolDecision = await tool.checkPermissions(
        input as never,
        toolContext,
        this.context,
      );
      if (
        toolDecision.behavior === "deny" ||
        toolDecision.behavior === "ask"
      ) {
        return toolDecision;
      }
      if (toolDecision.behavior === "allow") {
        return {
          behavior: "allow",
          reason: { type: "toolCheck", toolName },
        };
      }
    }

    // Step 4: bypassPermissions mode
    if (this.context.mode === "bypassPermissions") {
      return {
        behavior: "allow",
        reason: { type: "mode", mode: "bypassPermissions" },
      };
    }

    // Step 5: plan mode + isSearchOrReadCommand
    if (this.context.mode === "plan" && tool.isSearchOrReadCommand) {
      const result = tool.isSearchOrReadCommand(input as never);
      if (result.isSearch || result.isRead) {
        return {
          behavior: "allow",
          reason: { type: "mode", mode: "plan" },
        };
      }
    }

    // Step 6: Allow rules
    const allowRule = getAllowRuleForTool(
      this.context,
      toolName,
      inputContent,
    );
    if (allowRule) {
      return {
        behavior: "allow",
        reason: { type: "rule", rule: allowRule },
      };
    }

    // Step 7: Default → ask
    return {
      behavior: "ask",
      message: `Tool "${toolName}" requires permission`,
      reason: { type: "default" },
    };
  }
}

/**
 * Parse a rule string into a PermissionRuleValue.
 *
 * Format: "ToolName" or "ToolName(pattern*)"
 *
 * Examples:
 *   "Bash"            → { toolName: "Bash" }
 *   "Bash(npm test*)" → { toolName: "Bash", ruleContent: "npm test*" }
 *   "Read(*.md)"      → { toolName: "Read", ruleContent: "*.md" }
 */
export function parseRuleString(ruleStr: string): PermissionRuleValue {
  // Match: "ToolName(pattern)" — tool name can contain word chars, hyphens, dots, underscores
  const match = ruleStr.match(/^([^()]+)\((.+)\)$/);
  if (match) {
    return { toolName: match[1], ruleContent: match[2] };
  }
  return { toolName: ruleStr };
}

/**
 * Extract the relevant content string from a tool's input for rule matching.
 *
 * For Bash: returns the "command" field
 * For Read/Write/Edit: returns the "file_path" field
 * For Grep: returns the "pattern" field
 * For others: returns undefined
 */
function extractInputContent(
  tool: Tool,
  input: Record<string, unknown>,
): string | undefined {
  switch (tool.name) {
    case "Bash":
      return input.command as string | undefined;
    case "Read":
    case "Write":
    case "Edit":
      return input.file_path as string | undefined;
    case "Grep":
      return input.pattern as string | undefined;
    default:
      return undefined;
  }
}
