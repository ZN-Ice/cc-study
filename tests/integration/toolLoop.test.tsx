/**
 * Integration test for the full tool calling mechanism.
 *
 * Mocks streamChat to simulate LLM responses with tool_use blocks,
 * then verifies all 6 tools execute correctly through the
 * useStreamResponse → ToolRegistry → Tool chain.
 * No API key required.
 */
// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { StreamEvent, APIConfig } from "../../src/services/api.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Mock streamChat ─────────────────────────────────────────────────

vi.mock("../../src/services/api.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    streamChat: vi.fn(),
    resolveApiKey: () => "test-key",
  };
});

// ── Helpers ─────────────────────────────────────────────────────────

function* textEvents(text: string): Generator<StreamEvent, void> {
  yield { type: "content_block_start", index: 0, content_block: { type: "text" } };
  yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
  yield { type: "content_block_stop", index: 0 };
  yield { type: "message_delta", delta: { stop_reason: "end_turn" } };
}

function* toolUseEvents(
  toolId: string,
  toolName: string,
  inputJson: string,
): Generator<StreamEvent, void> {
  yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
  yield { type: "content_block_stop", index: 0 };
  yield {
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: toolId, name: toolName },
  };
  yield {
    type: "content_block_delta",
    index: 1,
    delta: { type: "input_json_delta", partial_json: inputJson },
  };
  yield { type: "content_block_stop", index: 1 };
  yield { type: "message_delta", delta: { stop_reason: "tool_use" } };
}

function toAsyncGen(
  gen: () => Generator<StreamEvent, void>,
): () => AsyncGenerator<StreamEvent, void> {
  return async function* () {
    yield* gen();
  };
}

/** Common setup: creates registry, config, mock harness. Returns cleanup-ready tmpDir. */
async function setupToolTest(workingDir?: string) {
  const { useStreamResponse } = await import("../../src/hooks/useStreamResponse.js");
  const { createDefaultRegistry } = await import("../../src/tools/index.js");
  const { renderHook, act } = await import("@testing-library/react");
  const { streamChat } = await import("../../src/services/api.js");

  const registry = createDefaultRegistry();
  const tmpDir = workingDir ?? mkdtempSync(join(tmpdir(), "cc-study-tool-"));
  const toolContext = {
    workingDirectory: tmpDir,
    abortSignal: new AbortController().signal,
  };

  const config: APIConfig = {
    apiKey: "test-key",
    model: "test-model",
    maxTokens: 1024,
    systemPrompt: "test",
    temperature: 0,
    tools: registry.getToolDefinitions(),
  };

  const messagesState: unknown[][] = [[]];
  const setMessages = vi.fn((updater: (prev: unknown[]) => unknown[]) => {
    const prev = messagesState[messagesState.length - 1];
    const next = updater(prev);
    messagesState.push(next);
    return next;
  });

  const mockStreamChat = vi.mocked(streamChat);

  return {
    registry,
    tmpDir,
    toolContext,
    config,
    messagesState,
    setMessages,
    mockStreamChat,
    useStreamResponse,
    renderHook,
    act,
  };
}

/** Extract the tool_result content from accumulated messages. */
function getToolResultContent(flat: unknown[]): string | undefined {
  const msg = flat.find(
    (m) =>
      typeof m === "object" && m !== null && "type" in m &&
      (m as { type: string }).type === "user" &&
      "content" in m &&
      Array.isArray((m as { content: unknown[] }).content) &&
      (m as { content: Array<{ type: string }> }).content.some((c) => c.type === "tool_result"),
  ) as { content: Array<{ type: string; content?: string; is_error?: boolean }> } | undefined;
  if (!msg) return undefined;
  return msg.content.find((c) => c.type === "tool_result")?.content;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Tool calling integration", () => {
  let mockStreamChat: ReturnType<typeof vi.fn>;
  const tmpDirs: string[] = [];

  beforeEach(async () => {
    const { streamChat } = await import("../../src/services/api.js");
    mockStreamChat = vi.mocked(streamChat);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of tmpDirs) {
      rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  // ── Bash ────────────────────────────────────────────────────────

  test("Bash tool: executes command and returns output", async () => {
    const s = await setupToolTest();
    tmpDirs.push(s.tmpDir);

    let callCount = 0;
    mockStreamChat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return toAsyncGen(() =>
          toolUseEvents("t1", "Bash", '{"command":"echo bash-works"}'),
        )();
      }
      return toAsyncGen(() => textEvents("Done."))();
    });

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, s.toolContext),
    );

    await s.act(async () => {
      await result.current.sendMessage("test");
    });

    expect(callCount).toBe(2);
    expect(getToolResultContent(s.messagesState.flat())).toContain("bash-works");
  });

  // ── FileRead ────────────────────────────────────────────────────

  test("FileRead tool: reads file content", async () => {
    const s = await setupToolTest();
    tmpDirs.push(s.tmpDir);

    const testFile = join(s.tmpDir, "readme.txt");
    writeFileSync(testFile, "hello from file read test");

    let callCount = 0;
    mockStreamChat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return toAsyncGen(() =>
          toolUseEvents("t1", "Read", JSON.stringify({ file_path: testFile })),
        )();
      }
      return toAsyncGen(() => textEvents("Done."))();
    });

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, s.toolContext),
    );

    await s.act(async () => {
      await result.current.sendMessage("test");
    });

    expect(callCount).toBe(2);
    expect(getToolResultContent(s.messagesState.flat())).toContain("hello from file read test");
  });

  // ── FileWrite ───────────────────────────────────────────────────

  test("FileWrite tool: creates new file", async () => {
    const s = await setupToolTest();
    tmpDirs.push(s.tmpDir);

    const targetFile = join(s.tmpDir, "written.txt");

    let callCount = 0;
    mockStreamChat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return toAsyncGen(() =>
          toolUseEvents("t1", "Write", JSON.stringify({
            file_path: targetFile,
            content: "written by tool",
          })),
        )();
      }
      return toAsyncGen(() => textEvents("Done."))();
    });

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, s.toolContext),
    );

    await s.act(async () => {
      await result.current.sendMessage("test");
    });

    expect(callCount).toBe(2);
    expect(getToolResultContent(s.messagesState.flat())).toContain("created");
    // Verify file was actually written
    expect(readFileSync(targetFile, "utf-8")).toBe("written by tool");
  });

  // ── FileEdit ────────────────────────────────────────────────────

  test("FileEdit tool: replaces string in existing file", async () => {
    const s = await setupToolTest();
    tmpDirs.push(s.tmpDir);

    const targetFile = join(s.tmpDir, "edit.txt");
    writeFileSync(targetFile, "hello world\nsecond line");

    let callCount = 0;
    mockStreamChat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return toAsyncGen(() =>
          toolUseEvents("t1", "Edit", JSON.stringify({
            file_path: targetFile,
            old_string: "hello world",
            new_string: "hello edit tool",
          })),
        )();
      }
      return toAsyncGen(() => textEvents("Done."))();
    });

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, s.toolContext),
    );

    await s.act(async () => {
      await result.current.sendMessage("test");
    });

    expect(callCount).toBe(2);
    expect(getToolResultContent(s.messagesState.flat())).toContain("updated");
    // Verify file was actually modified
    expect(readFileSync(targetFile, "utf-8")).toBe("hello edit tool\nsecond line");
  });

  // ── Glob ────────────────────────────────────────────────────────

  test("Glob tool: finds files matching pattern", async () => {
    const s = await setupToolTest();
    tmpDirs.push(s.tmpDir);

    // Create test files
    writeFileSync(join(s.tmpDir, "a.ts"), "a");
    writeFileSync(join(s.tmpDir, "b.ts"), "b");
    writeFileSync(join(s.tmpDir, "c.js"), "c");

    let callCount = 0;
    mockStreamChat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return toAsyncGen(() =>
          toolUseEvents("t1", "Glob", JSON.stringify({
            pattern: "*.ts",
            path: s.tmpDir,
          })),
        )();
      }
      return toAsyncGen(() => textEvents("Done."))();
    });

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, s.toolContext),
    );

    await s.act(async () => {
      await result.current.sendMessage("test");
    });

    expect(callCount).toBe(2);
    const output = getToolResultContent(s.messagesState.flat()) ?? "";
    expect(output).toContain("a.ts");
    expect(output).toContain("b.ts");
    expect(output).not.toContain("c.js");
  });

  // ── Grep ────────────────────────────────────────────────────────

  test("Grep tool: searches file contents", async () => {
    const s = await setupToolTest();
    tmpDirs.push(s.tmpDir);

    writeFileSync(join(s.tmpDir, "code.ts"), "function hello() {\n  return 'hello';\n}\n");
    writeFileSync(join(s.tmpDir, "other.ts"), "function world() {\n  return 'world';\n}\n");

    let callCount = 0;
    mockStreamChat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return toAsyncGen(() =>
          toolUseEvents("t1", "Grep", JSON.stringify({
            pattern: "hello",
            path: s.tmpDir,
          })),
        )();
      }
      return toAsyncGen(() => textEvents("Done."))();
    });

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, s.toolContext),
    );

    await s.act(async () => {
      await result.current.sendMessage("test");
    });

    expect(callCount).toBe(2);
    const output = getToolResultContent(s.messagesState.flat()) ?? "";
    expect(output).toContain("code.ts");
  });

  // ── Unknown tool ────────────────────────────────────────────────

  test("Unknown tool: returns error tool_result", async () => {
    const s = await setupToolTest();
    tmpDirs.push(s.tmpDir);

    let callCount = 0;
    mockStreamChat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return toAsyncGen(() =>
          toolUseEvents("t1", "NonExistentTool", '{"arg":"value"}'),
        )();
      }
      return toAsyncGen(() => textEvents("Done."))();
    });

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, s.toolContext),
    );

    await s.act(async () => {
      await result.current.sendMessage("test");
    });

    expect(callCount).toBe(2);
    const output = getToolResultContent(s.messagesState.flat()) ?? "";
    expect(output).toContain("Unknown tool");
  });

  // ── Multiple tools in single response ───────────────────────────

  test("Multiple tools: two Bash calls in one response", async () => {
    const s = await setupToolTest();
    tmpDirs.push(s.tmpDir);

    let callCount = 0;
    mockStreamChat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return (async function* () {
          yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
          yield { type: "content_block_stop", index: 0 };
          yield { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Bash" } };
          yield { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"command":"echo alpha"}' } };
          yield { type: "content_block_stop", index: 1 };
          yield { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "t2", name: "Bash" } };
          yield { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"command":"echo beta"}' } };
          yield { type: "content_block_stop", index: 2 };
          yield { type: "message_delta", delta: { stop_reason: "tool_use" } };
        })();
      }
      return toAsyncGen(() => textEvents("Done."))();
    });

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, s.toolContext),
    );

    await s.act(async () => {
      await result.current.sendMessage("test");
    });

    expect(callCount).toBe(2);

    // Find the message with two tool_results
    const flat = s.messagesState.flat();
    const msg = flat.find(
      (m) =>
        typeof m === "object" && m !== null && "type" in m &&
        (m as { type: string }).type === "user" &&
        "content" in m &&
        Array.isArray((m as { content: unknown[] }).content) &&
        (m as { content: Array<{ type: string }> }).content.filter((c) => c.type === "tool_result").length === 2,
    ) as { content: Array<{ type: string; content?: string }> } | undefined;

    expect(msg).toBeDefined();
    const results = msg!.content.filter((c) => c.type === "tool_result");
    expect(results[0].content).toContain("alpha");
    expect(results[1].content).toContain("beta");
  });
});
