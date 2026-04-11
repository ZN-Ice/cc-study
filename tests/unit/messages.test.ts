import { describe, test, expect } from "vitest";
import {
  createUserMessage,
  createAssistantMessage,
  generateMessageId,
  normalizeForAPI,
  type UserMessage,
  type AssistantMessage,
} from "../../src/messages.js";

describe("messages", () => {
  describe("generateMessageId", () => {
    test("generates unique IDs", () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();
      expect(id1).not.toBe(id2);
    });

    test("returns a string with expected format", () => {
      const id = generateMessageId();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe("createUserMessage", () => {
    test("creates a user message with text content", () => {
      const msg = createUserMessage("Hello, world!");
      expect(msg.type).toBe("user");
      expect(msg.content).toEqual([{ type: "text", text: "Hello, world!" }]);
      expect(msg.timestamp).toBeGreaterThan(0);
      expect(msg.id).toBeTruthy();
    });

    test("creates a user message with custom content blocks", () => {
      const blocks = [
        { type: "text" as const, text: "Hello" },
        { type: "tool_result" as const, tool_use_id: "tool-1", content: "result data" },
      ];
      const msg = createUserMessage(blocks);
      expect(msg.type).toBe("user");
      expect(msg.content).toEqual(blocks);
    });

    test("creates message with provided id", () => {
      const msg = createUserMessage("test", { id: "custom-id" });
      expect(msg.id).toBe("custom-id");
    });
  });

  describe("createAssistantMessage", () => {
    test("creates an assistant message with text content", () => {
      const msg = createAssistantMessage({
        content: [{ type: "text", text: "Hi there!" }],
        model: "claude-sonnet-4-6",
      });
      expect(msg.type).toBe("assistant");
      expect(msg.content).toEqual([{ type: "text", text: "Hi there!" }]);
      expect(msg.model).toBe("claude-sonnet-4-6");
      expect(msg.stopReason).toBeNull();
    });

    test("creates message with stop reason", () => {
      const msg = createAssistantMessage({
        content: [{ type: "text", text: "Done" }],
        model: "claude-sonnet-4-6",
        stopReason: "end_turn",
      });
      expect(msg.stopReason).toBe("end_turn");
    });
  });

  describe("normalizeForAPI", () => {
    test("converts user message to API format", () => {
      const userMsg: UserMessage = createUserMessage("Hello");
      const result = normalizeForAPI([userMsg]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      });
    });

    test("converts assistant message to API format", () => {
      const asstMsg: AssistantMessage = createAssistantMessage({
        content: [{ type: "text", text: "Hi" }],
        model: "claude-sonnet-4-6",
      });
      const result = normalizeForAPI([asstMsg]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
      });
    });

    test("preserves tool_use and tool_result blocks", () => {
      const userMsg: UserMessage = createUserMessage([
        { type: "tool_result", tool_use_id: "tu-1", content: "file contents" },
      ]);
      const asstMsg: AssistantMessage = createAssistantMessage({
        content: [{ type: "tool_use", id: "tu-1", name: "ReadFile", input: { path: "/foo" } }],
        model: "claude-sonnet-4-6",
      });

      const result = normalizeForAPI([asstMsg, userMsg]);
      expect(result[0].content[0]).toEqual({
        type: "tool_use",
        id: "tu-1",
        name: "ReadFile",
        input: { path: "/foo" },
      });
      expect(result[1].content[0]).toEqual({
        type: "tool_result",
        tool_use_id: "tu-1",
        content: "file contents",
      });
    });

    test("handles multi-turn conversation", () => {
      const messages = [
        createUserMessage("What is 1+1?"),
        createAssistantMessage({ content: [{ type: "text", text: "2" }], model: "test" }),
        createUserMessage("Thanks!"),
      ];

      const result = normalizeForAPI(messages);
      expect(result).toHaveLength(3);
      expect(result[0].role).toBe("user");
      expect(result[1].role).toBe("assistant");
      expect(result[2].role).toBe("user");
    });
  });
});
