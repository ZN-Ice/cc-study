import { randomUUID } from "node:crypto";

// ──────────────────────────────────────────────
// Content Block Types
// ──────────────────────────────────────────────

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface ToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
}

export interface ToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
  /** Which tool produced this result */
  readonly tool_name?: string;
  /** Original tool input for display */
  readonly tool_input?: Record<string, unknown>;
  /** Tool-specific data for rich rendering */
  readonly metadata?: Record<string, unknown>;
}

export interface ThinkingBlock {
  readonly type: "thinking";
  readonly thinking: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

// ──────────────────────────────────────────────
// Message Types
// ──────────────────────────────────────────────

export type MessageId = string;

export interface UserMessage {
  readonly type: "user";
  readonly id: MessageId;
  readonly content: readonly ContentBlock[];
  readonly timestamp: number;
}

export interface AssistantMessage {
  readonly type: "assistant";
  readonly id: MessageId;
  readonly content: readonly ContentBlock[];
  readonly timestamp: number;
  readonly model: string;
  readonly stopReason: string | null;
}

export type Message = UserMessage | AssistantMessage;

// ──────────────────────────────────────────────
// Factory Functions
// ──────────────────────────────────────────────

export function generateMessageId(): MessageId {
  return randomUUID();
}

interface CreateUserMessageOptions {
  readonly id?: MessageId;
}

/**
 * Create a user message from a text string or content blocks.
 */
export function createUserMessage(
  content: string | readonly ContentBlock[],
  options?: CreateUserMessageOptions,
): UserMessage {
  const blocks: readonly ContentBlock[] =
    typeof content === "string"
      ? [{ type: "text", text: content }]
      : content;

  return Object.freeze({
    type: "user",
    id: options?.id ?? generateMessageId(),
    content: blocks,
    timestamp: Date.now(),
  });
}

interface CreateAssistantMessageOptions {
  readonly content: readonly ContentBlock[];
  readonly model: string;
  readonly id?: MessageId;
  readonly stopReason?: string | null;
}

/**
 * Create an assistant message.
 */
export function createAssistantMessage(options: CreateAssistantMessageOptions): AssistantMessage {
  return Object.freeze({
    type: "assistant",
    id: options.id ?? generateMessageId(),
    content: options.content,
    timestamp: Date.now(),
    model: options.model,
    stopReason: options.stopReason ?? null,
  });
}

// ──────────────────────────────────────────────
// API Normalization
// ──────────────────────────────────────────────

interface APIMessage {
  readonly role: "user" | "assistant";
  readonly content: readonly ContentBlock[];
}

/**
 * Convert internal messages to the format expected by the Anthropic API.
 * Strips internal-only fields (tool_name, tool_input, metadata) from tool_result blocks.
 */
export function normalizeForAPI(messages: readonly Message[]): APIMessage[] {
  return messages.map((msg) => ({
    role: msg.type === "user" ? "user" : "assistant",
    content: msg.content.map((block) => {
      if (block.type === "tool_result") {
        const { tool_name: _, tool_input: __, metadata: ___, ...apiBlock } = block;
        return apiBlock;
      }
      return block;
    }),
  }));
}
