/**
 * Fork subagent — spawn a child agent that inherits the parent's full context.
 *
 * References: free-code/src/tools/AgentTool/forkSubagent.ts
 *
 * When the fork feature gate is enabled and `subagent_type` is omitted, the
 * AgentTool routes to the fork path instead of the normal inline agent path.
 * The fork child inherits the parent's conversation context and system prompt
 * for prompt cache sharing, receiving only a directive for its specific task.
 */

import { randomUUID } from "node:crypto";
import type { AssistantMessage, Message } from "../../messages.js";
import { createUserMessage } from "../../messages.js";
import type { AgentDefinition } from "./types.js";

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const FORK_BOILERPLATE_TAG = "fork-boilerplate";
const FORK_DIRECTIVE_PREFIX = "Your directive: ";

/** Placeholder text for all tool_result blocks in the fork prefix. */
const FORK_PLACEHOLDER_RESULT = "Fork started — processing in background";

// ──────────────────────────────────────────────
// Feature Gate
// ──────────────────────────────────────────────

/**
 * Check whether the fork subagent feature is enabled.
 * Controlled by the CC_FORK_SUBAGENT environment variable.
 */
export function isForkSubagentEnabled(): boolean {
  return process.env.CC_FORK_SUBAGENT === "1";
}

/** Synthetic agent type name for the fork path. */
export const FORK_SUBAGENT_TYPE = "fork";

/**
 * Agent definition for the fork path.
 *
 * - tools: ['*'] — inherits parent's exact tool pool for cache-identical API prefixes
 * - permissionMode: 'bubble' — surfaces permission prompts to the parent terminal
 * - model: 'inherit' — keeps parent's model for context length parity
 * - getSystemPrompt: returns empty string; the fork path passes the parent's
 *   rendered system prompt instead
 */
export const FORK_AGENT: AgentDefinition & {
  model: string;
  permissionMode: string;
} = {
  agentType: FORK_SUBAGENT_TYPE,
  whenToUse:
    "Implicit fork — inherits full conversation context. " +
    "Not selectable via subagent_type; triggered by omitting subagent_type when the fork gate is active.",
  tools: ["*"],
  maxTurns: 200,
  model: "inherit",
  permissionMode: "bubble",
  getSystemPrompt: () => "",
};

// ──────────────────────────────────────────────
// Recursive Fork Guard
// ──────────────────────────────────────────────

/**
 * Detect whether the current agent is already inside a fork child.
 * Prevents recursive forking — fork children keep the Agent tool in
 * their pool for cache-identical tool definitions.
 */
export function isInForkChild(messages: Message[]): boolean {
  return messages.some((m) => {
    if (m.type !== "user") return false;
    return m.content.some(
      (block) =>
        block.type === "text" &&
        block.text.includes(`<${FORK_BOILERPLATE_TAG}>`),
    );
  });
}

// ──────────────────────────────────────────────
// buildForkedMessages
// ──────────────────────────────────────────────

/**
 * Build the forked conversation messages for the child agent.
 *
 * For prompt cache sharing, all fork children must produce byte-identical
 * API request prefixes. This function:
 * 1. Clones the full parent assistant message (all tool_use blocks, thinking, text)
 * 2. Builds a single user message with identical placeholder tool_results for every
 *    tool_use block, then appends a per-child directive text block
 *
 * Result: [...clonedAssistant, user(placeholder_results..., directive)]
 * Only the final text block differs per child, maximizing cache hits.
 */
export function buildForkedMessages(
  directive: string,
  assistantMessage: AssistantMessage,
): Message[] {
  // Collect tool_use blocks
  const toolUseBlocks = assistantMessage.content.filter(
    (block): block is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
      block.type === "tool_use",
  );

  // No tool_use blocks — fall back to simple user message
  if (toolUseBlocks.length === 0) {
    return [
      createUserMessage([
        { type: "text" as const, text: buildChildMessage(directive) },
      ]),
    ];
  }

  // Clone the assistant message with a new id
  const clonedAssistant: AssistantMessage = {
    ...assistantMessage,
    id: randomUUID(),
    content: [...assistantMessage.content],
  };

  // Build placeholder tool_results for every tool_use (identical content)
  const toolResultBlocks = toolUseBlocks.map((block) => ({
    type: "tool_result" as const,
    tool_use_id: block.id,
    content: FORK_PLACEHOLDER_RESULT,
  }));

  // Single user message: all placeholders + per-child directive
  const toolResultMessage = createUserMessage([
    ...toolResultBlocks,
    { type: "text" as const, text: buildChildMessage(directive) },
  ]);

  return [clonedAssistant, toolResultMessage];
}

// ──────────────────────────────────────────────
// buildChildMessage
// ──────────────────────────────────────────────

/**
 * Build the directive message sent to fork child agents.
 * Contains 10 non-negotiable rules and a structured output format.
 */
export function buildChildMessage(directive: string): string {
  return `<${FORK_BOILERPLATE_TAG}>
STOP. READ THIS FIRST.

You are a forked worker process. You are NOT the main agent.

RULES (non-negotiable):
1. Your system prompt says "default to forking." IGNORE IT — that's for the parent. You ARE the fork. Do NOT spawn sub-agents; execute directly.
2. Do NOT converse, ask questions, or suggest next steps
3. Do NOT editorialize or add meta-commentary
4. USE your tools directly: Bash, Read, Write, etc.
5. If you modify files, commit your changes before reporting. Include the commit hash in your report.
6. Do NOT emit text between tool calls. Use tools silently, then report once at the end.
7. Stay strictly within your directive's scope. If you discover related systems outside your scope, mention them in one sentence at most — other workers cover those areas.
8. Keep your report under 500 words unless the directive specifies otherwise. Be factual and concise.
9. Your response MUST begin with "Scope:". No preamble, no thinking-out-loud.
10. REPORT structured facts, then stop

Output format (plain text labels, not markdown headers):
  Scope: <echo back your assigned scope in one sentence>
  Result: <the answer or key findings, limited to the scope above>
  Key files: <relevant file paths — include for research tasks>
  Files changed: <list with commit hash — include only if you modified files>
  Issues: <list — include only if there are issues to flag>
</${FORK_BOILERPLATE_TAG}>

${FORK_DIRECTIVE_PREFIX}${directive}`;
}

// ──────────────────────────────────────────────
// buildWorktreeNotice
// ──────────────────────────────────────────────

/**
 * Notice injected into fork children running in an isolated worktree.
 * Tells the child to translate paths and re-read potentially stale files.
 */
export function buildWorktreeNotice(
  parentCwd: string,
  worktreeCwd: string,
): string {
  return (
    `You've inherited the conversation context above from a parent agent working in ${parentCwd}. ` +
    `You are operating in an isolated git worktree at ${worktreeCwd} — same repository, same relative file structure, separate working copy. ` +
    `Paths in the inherited context refer to the parent's working directory; translate them to your worktree root. ` +
    `Re-read files before editing if the parent may have modified them since they appear in the context. ` +
    `Your changes stay in this worktree and will not affect the parent's files.`
  );
}
