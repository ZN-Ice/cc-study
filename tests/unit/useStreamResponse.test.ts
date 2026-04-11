// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStreamResponse } from "../../src/hooks/useStreamResponse.js";
import type { APIConfig, StreamEvent } from "../../src/services/api.js";

// ── Helpers ──────────────────────────────────────────────

const mockConfig: APIConfig = {
  apiKey: "test-key",
  model: "test-model",
  maxTokens: 1024,
  systemPrompt: "You are helpful.",
  temperature: 0,
};

// ── Mocks ────────────────────────────────────────────────

vi.mock("../../src/services/api.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    streamChat: vi.fn(),
    resolveApiKey: () => "test-key",
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
      yield {
        type: "content_block_delta",
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
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      } as StreamEvent;
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: " World" },
      } as StreamEvent;
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

    async function* failingStream() {
      // eslint-disable-next-line require-yield — intentionally throws before yielding
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
});
