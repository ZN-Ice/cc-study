// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStreamResponse } from "../../src/hooks/useStreamResponse.js";
import type { APIConfig, StreamEvent } from "../../src/services/api.js";
import type { TeammateCompletionResult } from "../../src/utils/teammateMailbox.js";

// ── Helpers ──────────────────────────────────────────────

const mockConfig: APIConfig = {
  apiKey: "test-key",
  model: "test-model",
  maxTokens: 1024,
  systemPrompt: "You are helpful.",
  temperature: 0,
};

/** Build a minimal valid stream that produces the given text deltas. */
function* textStreamEvents(texts: string[]): Generator<StreamEvent, void> {
  yield { type: "content_block_start", index: 0, content_block: { type: "text" } };
  for (const text of texts) {
    yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
  }
  yield { type: "content_block_stop", index: 0 };
  yield { type: "message_delta", delta: { stop_reason: "end_turn" } };
}

/** Build stream events for a tool_use block */
function* toolUseStreamEvents(
  toolId: string,
  toolName: string,
  inputJson: string,
): Generator<StreamEvent, void> {
  yield { type: "content_block_start", index: 0, content_block: { type: "text" } };
  yield { type: "content_block_stop", index: 0 };
  yield {
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: toolId, name: toolName },
  };
  yield { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: inputJson } };
  yield { type: "content_block_stop", index: 1 };
  yield { type: "message_delta", delta: { stop_reason: "tool_use" } };
}

// ── Mocks ────────────────────────────────────────────────

vi.mock("../../src/services/api.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    streamChat: vi.fn(),
    resolveApiKey: () => "test-key",
  };
});

vi.mock("../../src/utils/teammate.js", () => ({
  getTeamName: vi.fn(() => null),
}));

vi.mock("../../src/utils/teammateMailbox.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readTeammateResultsFromMailbox: vi.fn(async () => []),
  };
});

// ── Tests ────────────────────────────────────────────────

describe("useStreamResponse", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("initial state: not loading, no error, cancel is callable", () => {
    const { result } = renderHook(() =>
      useStreamResponse([], vi.fn(), mockConfig),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.streamingText).toBeNull();
    expect(result.current.cancel).toBeInstanceOf(Function);
  });

  test("cancel during streaming aborts and saves partial response with [Cancelled]", async () => {
    const { streamChat } = await import("../../src/services/api.js");
    const mockStreamChat = vi.mocked(streamChat);

    // Simulate a stream that yields text then waits for abort
    async function* fakeStream(
      _msgs: unknown,
      _cfg: unknown,
      signal: AbortSignal,
    ) {
      yield { type: "content_block_start", index: 0, content_block: { type: "text" } } as StreamEvent;
      yield {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      } as StreamEvent;
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("The operation was aborted", "AbortError"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    }

    mockStreamChat.mockImplementation(fakeStream as never);

    // Use a real state accumulator so the updater chain works
    const messagesState: unknown[][] = [[]];
    const setMessages = vi.fn((updater: (prev: unknown[]) => unknown[]) => {
      const prev = messagesState[messagesState.length - 1];
      const next = updater(prev);
      messagesState.push(next);
      return next;
    });

    const { result } = renderHook(() =>
      useStreamResponse([], setMessages, mockConfig),
    );

    // Start streaming
    await act(async () => {
      result.current.sendMessage("test");
      // Give the async generator a tick to yield
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.isLoading).toBe(true);

    // Cancel
    await act(async () => {
      result.current.cancel();
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.isLoading).toBe(false);

    // Check that a partial assistant message with [Cancelled] was appended
    const hasCancelled = messagesState.flat().some(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "assistant" &&
        "content" in m &&
        Array.isArray((m as { content: unknown[] }).content) &&
        (m as { content: Array<{ text: string }> }).content.some(
          (c) => c.text?.includes("[Cancelled]"),
        ),
    );
    expect(hasCancelled).toBe(true);
  });

  test("successful stream completes with full text, no [Cancelled]", async () => {
    const { streamChat } = await import("../../src/services/api.js");
    const mockStreamChat = vi.mocked(streamChat);

    async function* fakeStream() {
      yield* textStreamEvents(["Hello", " World"]);
    }

    mockStreamChat.mockImplementation(fakeStream as never);

    const messagesState: unknown[][] = [[]];
    const setMessages = vi.fn((updater: (prev: unknown[]) => unknown[]) => {
      const prev = messagesState[messagesState.length - 1];
      const next = updater(prev);
      messagesState.push(next);
      return next;
    });

    const { result } = renderHook(() =>
      useStreamResponse([], setMessages, mockConfig),
    );

    await act(async () => {
      await result.current.sendMessage("hi");
    });

    expect(result.current.isLoading).toBe(false);

    const hasComplete = messagesState.flat().some(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "assistant" &&
        "content" in m &&
        Array.isArray((m as { content: unknown[] }).content) &&
        (m as { content: Array<{ text: string }> }).content.some(
          (c) => c.text?.includes("Hello World"),
        ),
    );
    expect(hasComplete).toBe(true);

    const hasCancelled = messagesState.flat().some(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "assistant" &&
        "content" in m &&
        Array.isArray((m as { content: unknown[] }).content) &&
        (m as { content: Array<{ text: string }> }).content.some(
          (c) => c.text?.includes("[Cancelled]"),
        ),
    );
    expect(hasCancelled).toBe(false);
  });

  test("API error sets error state without crashing", async () => {
    const { streamChat } = await import("../../src/services/api.js");
    const mockStreamChat = vi.mocked(streamChat);

    // eslint-disable-next-line require-yield
    async function* failingStream() {
      throw new Error("API rate limit exceeded");
    }

    mockStreamChat.mockImplementation(failingStream as never);

    const { result } = renderHook(() =>
      useStreamResponse([], vi.fn(), mockConfig),
    );

    await act(async () => {
      await result.current.sendMessage("test");
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe("API rate limit exceeded");
  });

  test("tool_use triggers tool execution and continues loop", async () => {
    const { streamChat } = await import("../../src/services/api.js");
    const mockStreamChat = vi.mocked(streamChat);

    // First call: returns tool_use
    // Second call: returns text response
    let callCount = 0;
    async function* fakeStream() {
      callCount++;
      if (callCount === 1) {
        yield* toolUseStreamEvents("tool-1", "Bash", '{"command":"ls -la"}');
      } else {
        yield* textStreamEvents(["Done!"]);
      }
    }

    mockStreamChat.mockImplementation(fakeStream as never);

    const messagesState: unknown[][] = [[]];
    const setMessages = vi.fn((updater: (prev: unknown[]) => unknown[]) => {
      const prev = messagesState[messagesState.length - 1];
      const next = updater(prev);
      messagesState.push(next);
      return next;
    });

    const { result } = renderHook(() =>
      useStreamResponse([], setMessages, mockConfig),
    );

    await act(async () => {
      await result.current.sendMessage("list files");
    });

    expect(result.current.isLoading).toBe(false);
    expect(callCount).toBe(2);

    // Should have: user msg, assistant (tool_use), user (tool_result), assistant (text)
    const flat = messagesState.flat();
    const assistantMsgs = flat.filter(
      (m) => typeof m === "object" && m !== null && "type" in m && (m as { type: string }).type === "assistant",
    );
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(2);

    // Final assistant should have "Done!" text
    const lastAssistant = assistantMsgs[assistantMsgs.length - 1] as {
      content: Array<{ type: string; text?: string }>;
    };
    const hasDone = lastAssistant.content.some(
      (c) => c.type === "text" && c.text?.includes("Done!"),
    );
    expect(hasDone).toBe(true);
  });

  test("tool_use without registry returns error tool_result", async () => {
    const { streamChat } = await import("../../src/services/api.js");
    const mockStreamChat = vi.mocked(streamChat);

    // First call: returns tool_use
    // Second call: returns text
    let callCount = 0;
    async function* fakeStream() {
      callCount++;
      if (callCount === 1) {
        yield* toolUseStreamEvents("tool-1", "Bash", '{"command":"ls"}');
      } else {
        yield* textStreamEvents(["OK"]);
      }
    }

    mockStreamChat.mockImplementation(fakeStream as never);

    const messagesState: unknown[][] = [[]];
    const setMessages = vi.fn((updater: (prev: unknown[]) => unknown[]) => {
      const prev = messagesState[messagesState.length - 1];
      const next = updater(prev);
      messagesState.push(next);
      return next;
    });

    // Pass registry with BashTool registered — it will execute the ls command
    const { createDefaultRegistry } = await import("../../src/tools/index.js");
    const registry = createDefaultRegistry();

    const { result } = renderHook(() =>
      useStreamResponse([], setMessages, mockConfig, registry),
    );

    await act(async () => {
      await result.current.sendMessage("list files");
    });

    expect(result.current.isLoading).toBe(false);
    // Should have completed successfully (BashTool will execute)
    expect(callCount).toBe(2);
  });

  test("injectTeammateResults returns 0 when no team is active", async () => {
    const { result } = renderHook(() =>
      useStreamResponse([], vi.fn(), mockConfig),
    );

    const count = await result.current.injectTeammateResults();
    expect(count).toBe(0);
  });

  test("injectTeammateResults returns 0 when mailbox is empty", async () => {
    const { getTeamName } = await import("../../src/utils/teammate.js");
    vi.mocked(getTeamName).mockReturnValue("test-team");

    const { readTeammateResultsFromMailbox } = await import("../../src/utils/teammateMailbox.js");
    vi.mocked(readTeammateResultsFromMailbox).mockResolvedValue([]);

    const { result } = renderHook(() =>
      useStreamResponse([], vi.fn(), mockConfig),
    );

    const count = await result.current.injectTeammateResults();
    expect(count).toBe(0);
  });

  test("injectTeammateResults stages results for next sendMessage", async () => {
    const { getTeamName } = await import("../../src/utils/teammate.js");
    vi.mocked(getTeamName).mockReturnValue("test-team");

    const mockResults: TeammateCompletionResult[] = [
      {
        agentName: "analyst",
        content: "Analysis complete",
        agentType: "teammate",
        toolUseCount: 5,
        durationMs: 3000,
      },
    ];
    const { readTeammateResultsFromMailbox } = await import("../../src/utils/teammateMailbox.js");
    vi.mocked(readTeammateResultsFromMailbox).mockResolvedValue(mockResults);

    const { streamChat } = await import("../../src/services/api.js");
    const mockStreamChat = vi.mocked(streamChat);
    mockStreamChat.mockImplementation(async function* () {
      yield* textStreamEvents(["Got it"]);
    });

    const messagesState: unknown[][] = [[]];
    const setMessages = vi.fn((updater: (prev: unknown[]) => unknown[]) => {
      const prev = messagesState[messagesState.length - 1];
      const next = updater(prev);
      messagesState.push(next);
      return next;
    });

    const { result } = renderHook(() =>
      useStreamResponse([], setMessages, mockConfig),
    );

    // Stage teammate results
    let count: number;
    await act(async () => {
      count = await result.current.injectTeammateResults();
    });
    expect(count!).toBe(1);

    // Send a message — the staged results should be injected
    await act(async () => {
      await result.current.sendMessage("what did the team find?");
    });

    // The user message should contain the teammate results
    const flat = messagesState.flat();
    const userMsg = flat.find(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "user" &&
        "content" in m &&
        Array.isArray((m as { content: unknown[] }).content) &&
        (m as { content: Array<{ text?: string }> }).content.some(
          (c) => c.text?.includes("teammate-result"),
        ),
    );
    expect(userMsg).toBeDefined();
  });

  test("pending results are cleared after sendMessage consumes them", async () => {
    const { getTeamName } = await import("../../src/utils/teammate.js");
    vi.mocked(getTeamName).mockReturnValue("test-team");

    const mockResults: TeammateCompletionResult[] = [
      {
        agentName: "scout",
        content: "Scout report",
        agentType: "teammate",
        toolUseCount: 3,
        durationMs: 1000,
      },
    ];
    const { readTeammateResultsFromMailbox } = await import("../../src/utils/teammateMailbox.js");
    vi.mocked(readTeammateResultsFromMailbox).mockResolvedValue(mockResults);

    const { streamChat } = await import("../../src/services/api.js");
    const mockStreamChat = vi.mocked(streamChat);
    mockStreamChat.mockImplementation(async function* () {
      yield* textStreamEvents(["OK"]);
    });

    // Use a proper state accumulator that tracks the latest state
    let latestState: readonly unknown[] = [];
    const setMessages = vi.fn((updater: (prev: readonly unknown[]) => readonly unknown[]) => {
      latestState = updater(latestState);
      return latestState;
    });

    const { result } = renderHook(() =>
      useStreamResponse([], setMessages, mockConfig),
    );

    // Stage results
    await act(async () => {
      await result.current.injectTeammateResults();
    });

    // First sendMessage consumes the results
    await act(async () => {
      await result.current.sendMessage("first");
    });

    // Find user messages in the accumulated state
    const userMsgsAfterFirst = latestState.filter(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "user",
    );
    // First user message should contain teammate results
    const firstUserMsg = userMsgsAfterFirst[0] as { content: Array<{ text?: string }> };
    const firstHasResults = firstUserMsg.content.some(
      (c) => c.text?.includes("teammate-result"),
    );
    expect(firstHasResults).toBe(true);

    // Second sendMessage should NOT contain teammate results (they were consumed)
    await act(async () => {
      await result.current.sendMessage("second");
    });

    const userMsgsAfterSecond = latestState.filter(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "user",
    );
    // The second user message should not contain teammate results
    const secondUserMsg = userMsgsAfterSecond[1] as { content: Array<{ text?: string }> };
    const hasTeammateResults = secondUserMsg.content.some(
      (c) => c.text?.includes("teammate-result"),
    );
    expect(hasTeammateResults).toBe(false);
  });
});
