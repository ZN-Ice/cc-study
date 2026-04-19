/**
 * Permission system exports.
 */

export type {
  PermissionBehavior,
  PermissionMode,
  PermissionRule,
  PermissionRuleSource,
  PermissionRuleValue,
  PermissionDecision,
  PermissionDecisionReason,
  ToolPermissionContext,
  PermissionConfig,
  PermissionUpdate,
} from "./types.js";

export { PermissionManager, parseRuleString } from "./manager.js";

export {
  toolMatchesRule,
  contentMatchesRule,
  getDenyRuleForTool,
  getAskRuleForTool,
  getAllowRuleForTool,
} from "./rules.js";
