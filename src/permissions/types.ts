/**
 * Permission system type definitions.
 *
 * References: free-code/src/permissions.ts
 *
 * Simplified version of Claude Code's permission system:
 * - Three behaviors: allow / deny / ask
 * - Three modes: default / bypassPermissions / plan
 * - Three rule sources: userSettings / projectSettings / session
 */

// ──────────────────────────────────────────────
// Permission Behavior & Mode
// ──────────────────────────────────────────────

/** 权限行为（三态） */
export type PermissionBehavior = "allow" | "deny" | "ask";

/** 权限模式 */
export type PermissionMode =
  | "default"
  | "bypassPermissions"
  | "plan";

// ──────────────────────────────────────────────
// Permission Rule
// ──────────────────────────────────────────────

/** 规则来源 */
export type PermissionRuleSource =
  | "userSettings"
  | "projectSettings"
  | "session";

/** 规则值 */
export interface PermissionRuleValue {
  /** 工具名（如 "Bash", "Read"） */
  toolName: string;
  /** 内容匹配模式（glob，如 "npm install*", "*.md"） */
  ruleContent?: string;
}

/** 权限规则 */
export interface PermissionRule {
  source: PermissionRuleSource;
  behavior: PermissionBehavior;
  value: PermissionRuleValue;
}

// ──────────────────────────────────────────────
// Permission Decision
// ──────────────────────────────────────────────

/** 权限决策原因 */
export type PermissionDecisionReason =
  | { type: "rule"; rule: PermissionRule }
  | { type: "mode"; mode: PermissionMode }
  | { type: "toolCheck"; toolName: string }
  | { type: "safetyCheck"; reason: string }
  | { type: "default" };

/** 权限决策结果 */
export interface PermissionDecision {
  behavior: PermissionBehavior;
  message?: string;
  updatedInput?: Record<string, unknown>;
  reason?: PermissionDecisionReason;
}

// ──────────────────────────────────────────────
// Permission Context
// ──────────────────────────────────────────────

/** 工具权限上下文（运行时状态） */
export interface ToolPermissionContext {
  mode: PermissionMode;
  allowRules: PermissionRule[];
  denyRules: PermissionRule[];
  askRules: PermissionRule[];
}

// ──────────────────────────────────────────────
// Permission Config (for persistence)
// ──────────────────────────────────────────────

/** 配置文件中的权限配置格式 */
export interface PermissionConfig {
  mode?: PermissionMode;
  allow?: string[];
  deny?: string[];
  ask?: string[];
}

/** 权限更新（"Always allow" 时产生） */
export interface PermissionUpdate {
  type: "addRule";
  behavior: PermissionBehavior;
  value: PermissionRuleValue;
  destination: PermissionRuleSource;
}
