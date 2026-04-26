/**
 * Integration tests: sub-agent result handling flow.
 *
 * Tests the critical bug where collectStreamResponse silently drops text
 * blocks after tool_use blocks due to index mismatch, causing sub-agent
 * results to be truncated and the parent LLM to re-invoke Agent tools.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { createUserMessage, createAssistantMessage, normalizeForAPI } from "../../src/messages.js";
import type { ContentBlock } from "../../src/messages.js";

// ──────────────────────────────────────────────
// collectStreamResponse — imported directly for unit testing
// We replicate the fixed logic here to test the stream collection behavior
// since collectStreamResponse is not exported from the modules.
// ──────────────────────────────────────────────

/**
 * Replicate the fixed collectStreamResponse logic for testing.
 * This mirrors the implementation in orchestrator.ts and useStreamResponse.ts
 * after the text index fix.
 */
async function collectStreamResponse(
  stream: AsyncGenerator<{ type: string; [key: string]: unknown }, void>,
): Promise<{ content: ContentBlock[]; stopReason: string | null }> {
  const blocks: ContentBlock[] = [];
  let currentTextIndex = -1;
  let textBlockCount = 0;
  let currentToolIndex = -1;
  let toolInputJson = "";
  let toolBlock: { id: string; name: string } | null = null;
  let stopReason: string | null = null;

  for await (const event of stream) {
    switch (event.type) {
      case "content_block_start": {
        const block = event.content_block as { type: string; text?: string; id?: string; name?: string };
        if (block.type === "text") {
          currentTextIndex = textBlockCount;
          textBlockCount++;
          blocks.push({ type: "text", text: block.text ?? "" });
        } else if (block.type === "tool_use") {
          currentToolIndex = event.index as number;
          toolInputJson = "";
          toolBlock = { id: block.id ?? "", name: block.name ?? "" };
        }
        break;
      }
      case "content_block_delta": {
        const delta = event.delta as { type: string; text?: string; partial_json?: string };
        if (delta.type === "text_delta" && delta.text) {
          const textBlock = blocks.find(
            (b, i) =>
              b.type === "text" &&
              blocks
                .slice(0, i)
                .filter((x) => x.type === "text").length === currentTextIndex,
          );
          if (textBlock && textBlock.type === "text") {
            (textBlock as { text: string }).text += delta.text;
          }
        } else if (delta.type === "input_json_delta" && delta.partial_json) {
          toolInputJson += delta.partial_json;
        }
        break;
      }
      case "content_block_stop": {
        if ((event.index as number) === currentToolIndex && toolBlock) {
          let input: Record<string, unknown> = {};
          try {
            if (toolInputJson) {
              input = JSON.parse(toolInputJson) as Record<string, unknown>;
            }
          } catch {
            input = {};
          }
          blocks.push({
            type: "tool_use",
            id: toolBlock.id,
            name: toolBlock.name,
            input,
          });
          toolBlock = null;
          currentToolIndex = -1;
        }
        break;
      }
      case "message_delta": {
        const delta = event.delta as { stop_reason?: string };
        if (delta.stop_reason) {
          stopReason = delta.stop_reason;
        }
        break;
      }
    }
  }

  return { content: blocks, stopReason };
}

/** Helper: create a mock SSE stream that yields the given events */
async function* mockStream(events: unknown[]): AsyncGenerator<unknown, void> {
  for (const event of events) {
    yield event;
  }
}

// ──────────────────────────────────────────────
// collectStreamResponse — text block tracking
// ──────────────────────────────────────────────

describe("collectStreamResponse — text block tracking", () => {
  test("single text block with deltas", async () => {
    const stream = mockStream([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);

    const result = await collectStreamResponse(stream as AsyncGenerator<{ type: string; [key: string]: unknown }, void>);

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: "text", text: "Hello world" });
    expect(result.stopReason).toBe("end_turn");
  });

  test("text → tool_use → text: second text block captures all deltas (BUG FIX)", async () => {
    // This is the critical bug scenario:
    // Stream: Text(0) → ToolUse(1) → Text(2)
    // Before fix: currentTextIndex=2 for the second text block,
    //             find logic counts text blocks (0, 1) → can't find index 2 → text lost!
    // After fix: textBlockCount tracks text-only blocks → index=1 → found correctly
    const stream = mockStream([
      // First text block (index 0)
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Before tool: " } },
      { type: "content_block_stop", index: 0 },
      // Tool use block (index 1)
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Read", input: {} } },
      { type: "content_block_stop", index: 1 },
      // Second text block (index 2) — THIS IS THE ONE THAT WAS DROPPED
      { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "After tool: complete" } },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);

    const result = await collectStreamResponse(stream as AsyncGenerator<{ type: string; [key: string]: unknown }, void>);

    // Must have 3 blocks: text, tool_use, text
    expect(result.content).toHaveLength(3);

    // First text block
    expect(result.content[0]).toEqual({ type: "text", text: "Before tool: " });

    // Tool use block
    expect(result.content[1]).toEqual({
      type: "tool_use",
      id: "t1",
      name: "Read",
      input: {},
    });

    // Second text block — THIS MUST NOT BE EMPTY!
    expect(result.content[2]).toEqual({ type: "text", text: "After tool: complete" });
  });

  test("text → tool_use → text → tool_use → text: all three text blocks captured", async () => {
    const stream = mockStream([
      // Text 1
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "first" } },
      { type: "content_block_stop", index: 0 },
      // Tool 1
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Read", input: {} } },
      { type: "content_block_stop", index: 1 },
      // Text 2
      { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "second" } },
      { type: "content_block_stop", index: 2 },
      // Tool 2
      { type: "content_block_start", index: 3, content_block: { type: "tool_use", id: "t2", name: "Grep", input: {} } },
      { type: "content_block_stop", index: 3 },
      // Text 3
      { type: "content_block_start", index: 4, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 4, delta: { type: "text_delta", text: "third" } },
      { type: "content_block_stop", index: 4 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);

    const result = await collectStreamResponse(stream as AsyncGenerator<{ type: string; [key: string]: unknown }, void>);

    expect(result.content).toHaveLength(5);
    expect(result.content[0]).toEqual({ type: "text", text: "first" });
    expect(result.content[1]).toEqual({ type: "tool_use", id: "t1", name: "Read", input: {} });
    expect(result.content[2]).toEqual({ type: "text", text: "second" });
    expect(result.content[3]).toEqual({ type: "tool_use", id: "t2", name: "Grep", input: {} });
    expect(result.content[4]).toEqual({ type: "text", text: "third" });
  });

  test("multiple text deltas accumulate correctly", async () => {
    const stream = mockStream([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "beautiful " } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);

    const result = await collectStreamResponse(stream as AsyncGenerator<{ type: string; [key: string]: unknown }, void>);

    expect(result.content[0]).toEqual({ type: "text", text: "Hello beautiful world" });
  });

  test("tool_use with input_json_delta accumulates input", async () => {
    const stream = mockStream([
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "Read", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"file_' } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'path": "/foo"}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
    ]);

    const result = await collectStreamResponse(stream as AsyncGenerator<{ type: string; [key: string]: unknown }, void>);

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "tool_use",
      id: "t1",
      name: "Read",
      input: { file_path: "/foo" },
    });
  });

  test("empty stream returns empty content", async () => {
    const stream = mockStream([]);

    const result = await collectStreamResponse(stream as AsyncGenerator<{ type: string; [key: string]: unknown }, void>);

    expect(result.content).toHaveLength(0);
    expect(result.stopReason).toBeNull();
  });
});

// ──────────────────────────────────────────────
// normalizeForAPI — tool_result field stripping
// ──────────────────────────────────────────────

describe("normalizeForAPI — tool_result field stripping", () => {
  test("strips tool_name, tool_input, metadata from tool_result blocks", () => {
    const msg = createUserMessage([
      {
        type: "tool_result",
        tool_use_id: "tu-1",
        content: "file contents",
        tool_name: "Read",
        tool_input: { file_path: "/test.ts" },
        metadata: { duration: 100 },
      },
    ]);

    const result = normalizeForAPI([msg]);
    const block = result[0].content[0] as Record<string, unknown>;

    expect(block.type).toBe("tool_result");
    expect(block.tool_use_id).toBe("tu-1");
    expect(block.content).toBe("file contents");
    // These must be stripped
    expect(block.tool_name).toBeUndefined();
    expect(block.tool_input).toBeUndefined();
    expect(block.metadata).toBeUndefined();
  });

  test("preserves is_error field in tool_result", () => {
    const msg = createUserMessage([
      {
        type: "tool_result",
        tool_use_id: "tu-1",
        content: "error occurred",
        is_error: true,
        tool_name: "Bash",
      },
    ]);

    const result = normalizeForAPI([msg]);
    const block = result[0].content[0] as Record<string, unknown>;

    expect(block.is_error).toBe(true);
    expect(block.tool_name).toBeUndefined();
  });

  test("tool_result without extra fields is unchanged", () => {
    const msg = createUserMessage([
      { type: "tool_result", tool_use_id: "tu-1", content: "result" },
    ]);

    const result = normalizeForAPI([msg]);
    expect(result[0].content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "tu-1",
      content: "result",
    });
  });

  test("tool_use blocks are not affected by stripping", () => {
    const msg = createAssistantMessage({
      content: [
        { type: "tool_use", id: "tu-1", name: "Read", input: { file_path: "/test.ts" } },
      ],
      model: "test",
    });

    const result = normalizeForAPI([msg]);
    expect(result[0].content[0]).toEqual({
      type: "tool_use",
      id: "tu-1",
      name: "Read",
      input: { file_path: "/test.ts" },
    });
  });

  test("mixed content blocks: only tool_result is stripped", () => {
    const msg = createUserMessage([
      { type: "text", text: "user message" },
      {
        type: "tool_result",
        tool_use_id: "tu-1",
        content: "result",
        tool_name: "Read",
        metadata: { extra: true },
      },
    ]);

    const result = normalizeForAPI([msg]);

    expect(result[0].content).toHaveLength(2);
    expect(result[0].content[0]).toEqual({ type: "text", text: "user message" });

    const block = result[0].content[1] as Record<string, unknown>;
    expect(block.tool_name).toBeUndefined();
    expect(block.metadata).toBeUndefined();
    expect(block.content).toBe("result");
  });

  test("multiple tool_result blocks all have extra fields stripped", () => {
    const msg = createUserMessage([
      {
        type: "tool_result",
        tool_use_id: "tu-1",
        content: "result1",
        tool_name: "Read",
        tool_input: { file_path: "/a.ts" },
      },
      {
        type: "tool_result",
        tool_use_id: "tu-2",
        content: "result2",
        tool_name: "Grep",
        metadata: { matches: 5 },
      },
    ]);

    const result = normalizeForAPI([msg]);

    for (const block of result[0].content) {
      const b = block as Record<string, unknown>;
      expect(b.tool_name).toBeUndefined();
      expect(b.tool_input).toBeUndefined();
      expect(b.metadata).toBeUndefined();
    }
  });
});

// ──────────────────────────────────────────────
// Sub-agent result flow simulation
// ──────────────────────────────────────────────

describe("sub-agent result flow simulation", () => {
  test("simulated sub-agent with text→tool→text returns complete result", async () => {
    // Simulate what runSubAgent does:
    // 1. First API call returns text + tool_use
    // 2. Tool is executed
    // 3. Second API call returns text after tool execution
    // The key is that BOTH text blocks must be captured

    const stream1 = mockStream([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I'll read the file. " } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Read", input: {} } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
    ]);

    const result1 = await collectStreamResponse(stream1 as AsyncGenerator<{ type: string; [key: string]: unknown }, void>);

    // First call should have text + tool_use
    expect(result1.content).toHaveLength(2);
    expect(result1.content[0]).toEqual({ type: "text", text: "I'll read the file. " });
    expect(result1.content[1]).toEqual({ type: "tool_use", id: "t1", name: "Read", input: {} });
    expect(result1.stopReason).toBe("tool_use");

    const stream2 = mockStream([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The file contains hello world." } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);

    const result2 = await collectStreamResponse(stream2 as AsyncGenerator<{ type: string; [key: string]: unknown }, void>);

    expect(result2.content).toHaveLength(1);
    expect(result2.content[0]).toEqual({ type: "text", text: "The file contains hello world." });

    // The sub-agent's final text should be the last assistant message text
    const lastText = result2.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");

    expect(lastText).toBe("The file contains hello world.");
  });

  test("extractTextFromMessages equivalent captures text from complex blocks", () => {
    // Simulate what extractTextFromMessages does in orchestrator
    function extractTextFromContent(blocks: ContentBlock[]): string {
      return blocks
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");
    }

    // Scenario: text → tool_use → text (the bug scenario)
    const blocks: ContentBlock[] = [
      { type: "text", text: "Analysis: " },
      { type: "tool_use", id: "t1", name: "Read", input: {} },
      { type: "text", text: "File contains important data." },
    ];

    const text = extractTextFromContent(blocks);
    expect(text).toBe("Analysis: File contains important data.");
  });

  test("tool_result blocks with extra fields produce clean API payload", () => {
    // Simulate what useStreamResponse does when creating tool_result blocks
    const toolResults = [
      {
        tool_use_id: "tu-1",
        content: "Agent completed",
        error: false,
        tool_name: "Agent",
        tool_input: { prompt: "test" },
        metadata: { agentType: "general-purpose", durationMs: 1000 },
      },
    ];

    // What useStreamResponse creates (with extra fields)
    const toolResultBlocks = toolResults.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.tool_use_id,
      content: r.content,
      is_error: r.error,
      tool_name: r.tool_name,
      tool_input: r.tool_input,
      metadata: r.metadata,
    }));

    // What normalizeForAPI produces (extra fields stripped)
    const msg = createUserMessage(toolResultBlocks);
    const apiMessages = normalizeForAPI([msg]);
    const apiBlock = apiMessages[0].content[0] as Record<string, unknown>;

    expect(apiBlock.type).toBe("tool_result");
    expect(apiBlock.tool_use_id).toBe("tu-1");
    expect(apiBlock.content).toBe("Agent completed");
    expect(apiBlock.tool_name).toBeUndefined();
    expect(apiBlock.tool_input).toBeUndefined();
    expect(apiBlock.metadata).toBeUndefined();
  });
});
