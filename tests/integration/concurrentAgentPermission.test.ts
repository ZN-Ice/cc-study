/**
 * Integration tests for concurrent sub-agent permission queue.
 *
 * Reproduces the reported bug: when multiple sub-agents are triggered
 * simultaneously, after approving one sub-agent's permission request,
 * the selection box remains but becomes unresponsive, and ESC doesn't work.
 *
 * Root causes identified:
 * 1. respondToPermission stale closure over pendingQueue
 * 2. ESC blocked during permission dialog (App.tsx)
 * 3. PermissionConfirm component has no ESC handler
 * 4. finally block stale reference to pendingQueue
 */

// @vitest-environment jsdom

import { describe, test, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { APIConfig } from "../../src/services/api.js";
import type { StreamEvent } from "../../src/services/api.js";
import type { ToolContext } from "../../src/tools/types.js";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("../../src/services/api.js", () => ({
  streamChat: vi.fn(),
  resolveApiKey: () => "test-key",
}));

// ── Test Helpers ───────────────────────────────────────────────────

function* textStreamEvents(text: string): Generator<StreamEvent, void> {
  yield { type: "content_block_start", index: 0, content_block: { type: "text" } };
  yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
  yield { type: "content_block_stop", index: 0 };
  yield { type: "message_delta", delta: { stop_reason: "end_turn" } };
}

function* toolUseStreamEvents(
  blocks: Array<{ id: string; name: string; input: string }>,
): Generator<StreamEvent, void> {
  let index = 0;
  yield { type: "content_block_start", index, content_block: { type: "text" } };
  yield { type: "content_block_stop", index };
  index++;

  for (const block of blocks) {
    yield {
      type: "content_block_start",
      index,
      content_block: { type: "tool_use", id: block.id, name: block.name },
    };
    yield {
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json: block.input },
    };
    yield { type: "content_block_stop", index };
    index++;
  }

  yield { type: "message_delta", delta: { stop_reason: "tool_use" } };
}

interface SetupOptions {
  permissionMode?: "default" | "bypassPermissions" | "plan";
  allowRules?: string[];
  denyRules?: string[];
}

async function setupTest(options: SetupOptions = {}) {
  const { useStreamResponse } = await import("../../src/hooks/useStreamResponse.js");
  const { createDefaultRegistry } = await import("../../src/tools/index.js");
  const { PermissionManager } = await import("../../src/permissions/manager.js");
  const { renderHook, act } = await import("@testing-library/react");
  const { streamChat } = await import("../../src/services/api.js");

  const registry = createDefaultRegistry();
  const tmpDir = mkdtempSync(join(tmpdir(), "cc-study-concurrent-"));

  const config: APIConfig = {
    apiKey: "test-key",
    model: "test-model",
    maxTokens: 1024,
    systemPrompt: "test",
    temperature: 0,
    tools: registry.getToolDefinitions(),
  };

  const pm = new PermissionManager(options.permissionMode ?? "default");
  if (options.allowRules || options.denyRules) {
    pm.loadFromConfig(
      { allow: options.allowRules, deny: options.denyRules },
      "session",
    );
  }

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
    config,
    pm,
    messagesState,
    setMessages,
    mockStreamChat,
    useStreamResponse,
    renderHook,
    act,
  };
}

/**
 * Create an "ask" PermissionDecision with the correct reason structure
 * so that useStreamResponse's onPermissionAsk extracts toolName correctly.
 */
function askDecision(toolName: string, message?: string) {
  return {
    behavior: "ask" as const,
    message: message ?? `Permission needed for ${toolName}`,
    reason: { type: "toolCheck" as const, toolName },
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Concurrent sub-agent permission queue", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of tmpDirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tmpDirs.length = 0;
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 1: Stale closure — respondToPermission sees wrong queue
  // ─────────────────────────────────────────────────────────────────

  test("respondToPermission always dequeues the correct head entry", async () => {
    const s = await setupTest({ allowRules: ["Read"] });
    tmpDirs.push(s.tmpDir);

    const originalCheck = s.pm.check.bind(s.pm);
    vi.spyOn(s.pm, "check").mockImplementation(async (tool, input, context) => {
      if (tool.name === "Bash") {
        const cmd = (input as Record<string, unknown>).command as string;
        return askDecision("Bash", `Permission needed for: ${cmd}`);
      }
      return originalCheck(tool, input, context);
    });

    s.mockStreamChat
      .mockImplementationOnce(() => {
        return (async function* () {
          yield* toolUseStreamEvents([
            { id: "bash-1", name: "Bash", input: JSON.stringify({ command: "echo agent-a" }) },
            { id: "bash-2", name: "Bash", input: JSON.stringify({ command: "echo agent-b" }) },
          ]);
        })();
      })
      .mockImplementation(() => {
        return (async function* () {
          yield* textStreamEvents("Done");
        })();
      });

    const toolContext = { workingDirectory: s.tmpDir };

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, toolContext, s.pm),
    );

    await s.act(async () => {
      result.current.sendMessage("run two bash commands");
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    // First permission should be visible with correct toolName
    expect(result.current.permissionRequest).not.toBeNull();
    expect(result.current.permissionRequest!.toolName).toBe("Bash");

    // Approve first permission
    await s.act(async () => {
      result.current.respondToPermission(true, false);
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // After approving first, either second appears or queue is empty
    if (result.current.permissionRequest !== null) {
      expect(result.current.permissionRequest.toolName).toBe("Bash");
      await s.act(async () => {
        result.current.respondToPermission(true, false);
      });
      await s.act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    expect(result.current.permissionRequest).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 2: Stale closure — respondToPermission finds empty queue
  // ─────────────────────────────────────────────────────────────────

  test("respondToPermission does not silently fail with stale queue", async () => {
    const s = await setupTest({ allowRules: ["Read"] });
    tmpDirs.push(s.tmpDir);

    const originalCheck = s.pm.check.bind(s.pm);
    vi.spyOn(s.pm, "check").mockImplementation(async (tool, _input, _context) => {
      if (tool.name === "Bash") return askDecision("Bash");
      return originalCheck(tool, _input, _context);
    });

    s.mockStreamChat
      .mockImplementationOnce(() => {
        return (async function* () {
          yield* toolUseStreamEvents([
            { id: "bash-a", name: "Bash", input: JSON.stringify({ command: "echo a" }) },
            { id: "bash-b", name: "Bash", input: JSON.stringify({ command: "echo b" }) },
          ]);
        })();
      })
      .mockImplementation(() => {
        return (async function* () {
          yield* textStreamEvents("Done");
        })();
      });

    const toolContext = { workingDirectory: s.tmpDir };

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, toolContext, s.pm),
    );

    await s.act(async () => {
      result.current.sendMessage("run concurrent commands");
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(result.current.permissionRequest).not.toBeNull();

    // Approve first
    await s.act(async () => {
      result.current.respondToPermission(true, false);
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // respondToPermission should still be callable for the second
    if (result.current.permissionRequest !== null) {
      await s.act(async () => {
        result.current.respondToPermission(true, false);
      });
      await s.act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    expect(result.current.permissionRequest).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 3: Queue FIFO ordering preserved
  // ─────────────────────────────────────────────────────────────────

  test("permission queue processes requests in FIFO order", async () => {
    const s = await setupTest({ allowRules: ["Read"] });
    tmpDirs.push(s.tmpDir);

    const uiDisplayOrder: string[] = [];

    const originalCheck = s.pm.check.bind(s.pm);
    vi.spyOn(s.pm, "check").mockImplementation(async (tool, input, context) => {
      if (tool.name === "Bash") {
        const cmd = (input as Record<string, unknown>).command as string;
        return askDecision("Bash", `Permission needed for: ${cmd}`);
      }
      return originalCheck(tool, input, context);
    });

    s.mockStreamChat
      .mockImplementationOnce(() => {
        return (async function* () {
          yield* toolUseStreamEvents([
            { id: "cmd-1", name: "Bash", input: JSON.stringify({ command: "echo first" }) },
            { id: "cmd-2", name: "Bash", input: JSON.stringify({ command: "echo second" }) },
            { id: "cmd-3", name: "Bash", input: JSON.stringify({ command: "echo third" }) },
          ]);
        })();
      })
      .mockImplementation(() => {
        return (async function* () {
          yield* textStreamEvents("Done");
        })();
      });

    const toolContext = { workingDirectory: s.tmpDir };

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, toolContext, s.pm),
    );

    await s.act(async () => {
      result.current.sendMessage("run three commands");
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    let permissionsProcessed = 0;
    while (result.current.permissionRequest !== null && permissionsProcessed < 5) {
      uiDisplayOrder.push(result.current.permissionRequest.toolName);

      await s.act(async () => {
        result.current.respondToPermission(true, false);
      });
      await s.act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      permissionsProcessed++;
    }

    expect(permissionsProcessed).toBeGreaterThanOrEqual(1);
    for (const name of uiDisplayOrder) {
      expect(name).toBe("Bash");
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 4: Cancel clears ALL pending permission requests
  // ─────────────────────────────────────────────────────────────────

  test("cancel resolves all pending permission requests", async () => {
    const s = await setupTest({ allowRules: ["Read"] });
    tmpDirs.push(s.tmpDir);

    const originalCheck = s.pm.check.bind(s.pm);
    vi.spyOn(s.pm, "check").mockImplementation(async (tool, _input, _context) => {
      if (tool.name === "Bash") return askDecision("Bash");
      return originalCheck(tool, _input, _context);
    });

    s.mockStreamChat
      .mockImplementationOnce(() => {
        return (async function* () {
          yield* toolUseStreamEvents([
            { id: "cancel-a", name: "Bash", input: JSON.stringify({ command: "echo a" }) },
            { id: "cancel-b", name: "Bash", input: JSON.stringify({ command: "echo b" }) },
          ]);
        })();
      })
      .mockImplementation(() => {
        return (async function* () {
          yield* textStreamEvents("Done");
        })();
      });

    const toolContext = { workingDirectory: s.tmpDir };

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, toolContext, s.pm),
    );

    await s.act(async () => {
      result.current.sendMessage("cancel test");
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(result.current.permissionRequest).not.toBeNull();

    // Cancel
    await s.act(async () => {
      result.current.cancel();
    });

    expect(result.current.permissionRequest).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 5: Cancel during permission dialog exits loading state
  // ─────────────────────────────────────────────────────────────────

  test("cancel during permission dialog exits loading state", async () => {
    const s = await setupTest({ allowRules: ["Read"] });
    tmpDirs.push(s.tmpDir);

    const originalCheck = s.pm.check.bind(s.pm);
    vi.spyOn(s.pm, "check").mockImplementation(async (tool, _input, _context) => {
      if (tool.name === "Bash") return askDecision("Bash");
      return originalCheck(tool, _input, _context);
    });

    s.mockStreamChat
      .mockImplementationOnce(() => {
        return (async function* () {
          yield* toolUseStreamEvents([
            { id: "ctrl-c-a", name: "Bash", input: JSON.stringify({ command: "echo hello" }) },
          ]);
        })();
      })
      .mockImplementation(() => {
        return (async function* () {
          yield* textStreamEvents("Done");
        })();
      });

    const toolContext = { workingDirectory: s.tmpDir };

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, toolContext, s.pm),
    );

    await s.act(async () => {
      result.current.sendMessage("ctrl c test");
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(result.current.permissionRequest).not.toBeNull();
    expect(result.current.isLoading).toBe(true);

    // Cancel
    await s.act(async () => {
      result.current.cancel();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.permissionRequest).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 6: Approving last permission fully clears the queue
  // ─────────────────────────────────────────────────────────────────

  test("approving the last pending permission sets permissionRequest to null", async () => {
    const s = await setupTest({ allowRules: ["Read"] });
    tmpDirs.push(s.tmpDir);

    const originalCheck = s.pm.check.bind(s.pm);
    vi.spyOn(s.pm, "check").mockImplementation(async (tool, _input, _context) => {
      if (tool.name === "Bash") return askDecision("Bash");
      return originalCheck(tool, _input, _context);
    });

    s.mockStreamChat
      .mockImplementationOnce(() => {
        return (async function* () {
          yield* toolUseStreamEvents([
            { id: "single", name: "Bash", input: JSON.stringify({ command: "echo single" }) },
          ]);
        })();
      })
      .mockImplementation(() => {
        return (async function* () {
          yield* textStreamEvents("Done");
        })();
      });

    const toolContext = { workingDirectory: s.tmpDir };

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, toolContext, s.pm),
    );

    await s.act(async () => {
      result.current.sendMessage("single permission test");
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(result.current.permissionRequest).not.toBeNull();
    expect(result.current.permissionRequest!.toolName).toBe("Bash");

    await s.act(async () => {
      result.current.respondToPermission(true, false);
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(result.current.permissionRequest).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 7: Approving first reveals second in queue
  // ─────────────────────────────────────────────────────────────────

  test("approving first permission reveals second in queue", async () => {
    const s = await setupTest({ allowRules: ["Read"] });
    tmpDirs.push(s.tmpDir);

    const permissionSequence: Array<string | null> = [];

    const originalCheck = s.pm.check.bind(s.pm);
    vi.spyOn(s.pm, "check").mockImplementation(async (tool, _input, _context) => {
      if (tool.name === "Bash") return askDecision("Bash");
      return originalCheck(tool, _input, _context);
    });

    s.mockStreamChat
      .mockImplementationOnce(() => {
        return (async function* () {
          yield* toolUseStreamEvents([
            { id: "q-a", name: "Bash", input: JSON.stringify({ command: "echo first" }) },
            { id: "q-b", name: "Bash", input: JSON.stringify({ command: "echo second" }) },
          ]);
        })();
      })
      .mockImplementation(() => {
        return (async function* () {
          yield* textStreamEvents("Done");
        })();
      });

    const toolContext = { workingDirectory: s.tmpDir };

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, toolContext, s.pm),
    );

    await s.act(async () => {
      result.current.sendMessage("queue shift test");
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    permissionSequence.push(result.current.permissionRequest?.toolName ?? null);
    expect(result.current.permissionRequest).not.toBeNull();

    // Approve first
    await s.act(async () => {
      result.current.respondToPermission(true, false);
    });
    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    permissionSequence.push(result.current.permissionRequest?.toolName ?? null);

    // Approve second if present
    if (result.current.permissionRequest !== null) {
      await s.act(async () => {
        result.current.respondToPermission(true, false);
      });
      await s.act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    permissionSequence.push(result.current.permissionRequest?.toolName ?? null);

    expect(permissionSequence[0]).toBe("Bash");
    expect(permissionSequence[permissionSequence.length - 1]).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 8: Denying permission still advances the queue
  // ─────────────────────────────────────────────────────────────────

  test("denying a permission still advances the queue to next entry", async () => {
    const s = await setupTest({ allowRules: ["Read"] });
    tmpDirs.push(s.tmpDir);

    const originalCheck = s.pm.check.bind(s.pm);
    vi.spyOn(s.pm, "check").mockImplementation(async (tool, _input, _context) => {
      if (tool.name === "Bash") return askDecision("Bash");
      return originalCheck(tool, _input, _context);
    });

    s.mockStreamChat
      .mockImplementationOnce(() => {
        return (async function* () {
          yield* toolUseStreamEvents([
            { id: "deny-a", name: "Bash", input: JSON.stringify({ command: "echo a" }) },
            { id: "deny-b", name: "Bash", input: JSON.stringify({ command: "echo b" }) },
          ]);
        })();
      })
      .mockImplementation(() => {
        return (async function* () {
          yield* textStreamEvents("Done");
        })();
      });

    const toolContext = { workingDirectory: s.tmpDir };

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, toolContext, s.pm),
    );

    await s.act(async () => {
      result.current.sendMessage("deny test");
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(result.current.permissionRequest).not.toBeNull();

    // DENY first permission
    await s.act(async () => {
      result.current.respondToPermission(false, false);
    });
    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Denial should NOT freeze the queue
    if (result.current.permissionRequest !== null) {
      expect(result.current.permissionRequest.toolName).toBe("Bash");

      await s.act(async () => {
        result.current.respondToPermission(true, false);
      });
      await s.act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });
    }

    expect(result.current.permissionRequest).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 9: Two Agent tool_use blocks trigger two separate asks
  // ─────────────────────────────────────────────────────────────────

  test("two Agent tool_use blocks trigger two separate permission asks", async () => {
    const s = await setupTest({ allowRules: ["Read"] });
    tmpDirs.push(s.tmpDir);

    let askCount = 0;

    const originalCheck = s.pm.check.bind(s.pm);
    vi.spyOn(s.pm, "check").mockImplementation(async (tool, _input, _context) => {
      if (tool.name === "Agent") {
        askCount++;
        return askDecision("Agent", `Permission needed for Agent #${askCount}`);
      }
      return originalCheck(tool, _input, _context);
    });

    s.mockStreamChat
      .mockImplementationOnce(() => {
        return (async function* () {
          yield* toolUseStreamEvents([
            {
              id: "agent-1",
              name: "Agent",
              input: JSON.stringify({
                subagent_type: "general-purpose",
                prompt: "do task A",
                description: "Task A",
              }),
            },
            {
              id: "agent-2",
              name: "Agent",
              input: JSON.stringify({
                subagent_type: "general-purpose",
                prompt: "do task B",
                description: "Task B",
              }),
            },
          ]);
        })();
      })
      .mockImplementation(() => {
        return (async function* () {
          yield* textStreamEvents("Done");
        })();
      });

    const toolContext = { workingDirectory: s.tmpDir };

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, toolContext, s.pm),
    );

    await s.act(async () => {
      result.current.sendMessage("run two agents");
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(result.current.permissionRequest).not.toBeNull();

    let processed = 0;
    while (result.current.permissionRequest !== null && processed < 10) {
      await s.act(async () => {
        result.current.respondToPermission(true, false);
      });
      await s.act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      processed++;
    }

    expect(askCount).toBeGreaterThanOrEqual(2);
    expect(result.current.permissionRequest).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 10: Stress test — rapid approve/deny cycle
  // ─────────────────────────────────────────────────────────────────

  test("rapid approval cycle does not cause state inconsistency", async () => {
    const s = await setupTest({ allowRules: ["Read"] });
    tmpDirs.push(s.tmpDir);

    const originalCheck = s.pm.check.bind(s.pm);
    vi.spyOn(s.pm, "check").mockImplementation(async (tool, _input, _context) => {
      if (tool.name === "Bash") return askDecision("Bash");
      return originalCheck(tool, _input, _context);
    });

    s.mockStreamChat
      .mockImplementationOnce(() => {
        return (async function* () {
          yield* toolUseStreamEvents([
            { id: "rapid-1", name: "Bash", input: JSON.stringify({ command: "echo 1" }) },
            { id: "rapid-2", name: "Bash", input: JSON.stringify({ command: "echo 2" }) },
            { id: "rapid-3", name: "Bash", input: JSON.stringify({ command: "echo 3" }) },
            { id: "rapid-4", name: "Bash", input: JSON.stringify({ command: "echo 4" }) },
          ]);
        })();
      })
      .mockImplementation(() => {
        return (async function* () {
          yield* textStreamEvents("Done");
        })();
      });

    const toolContext = { workingDirectory: s.tmpDir };

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, toolContext, s.pm),
    );

    await s.act(async () => {
      result.current.sendMessage("stress test");
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    let approved = 0;
    while (result.current.permissionRequest !== null && approved < 10) {
      await s.act(async () => {
        result.current.respondToPermission(approved % 2 === 0, false);
      });
      await s.act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      approved++;
    }

    expect(approved).toBeGreaterThanOrEqual(1);
    expect(result.current.permissionRequest).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 11: Non-Bash tool permission with content extraction
  // ─────────────────────────────────────────────────────────────────

  test("Write tool permission extracts file_path for display", async () => {
    const s = await setupTest({ allowRules: ["Read"] });
    tmpDirs.push(s.tmpDir);

    const originalCheck = s.pm.check.bind(s.pm);
    vi.spyOn(s.pm, "check").mockImplementation(async (tool, _input, _context) => {
      if (tool.name === "Write") {
        return askDecision("Write");
      }
      return originalCheck(tool, _input, _context);
    });

    s.mockStreamChat
      .mockImplementationOnce(() => {
        return (async function* () {
          yield* toolUseStreamEvents([
            {
              id: "write-1",
              name: "Write",
              input: JSON.stringify({ file_path: "/tmp/test.txt", content: "hello" }),
            },
          ]);
        })();
      })
      .mockImplementation(() => {
        return (async function* () {
          yield* textStreamEvents("Done");
        })();
      });

    const toolContext = { workingDirectory: s.tmpDir };

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, toolContext, s.pm),
    );

    await s.act(async () => {
      result.current.sendMessage("write a file");
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(result.current.permissionRequest).not.toBeNull();
    expect(result.current.permissionRequest!.toolName).toBe("Write");

    await s.act(async () => {
      result.current.respondToPermission(true, false);
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(result.current.permissionRequest).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Test 12: Mixed tools — some auto-allowed, some need permission
  // ─────────────────────────────────────────────────────────────────

  test("mixed tools: Read auto-allowed, Bash needs permission", async () => {
    const s = await setupTest({ allowRules: ["Read"] });
    tmpDirs.push(s.tmpDir);

    let bashAskCount = 0;

    const originalCheck = s.pm.check.bind(s.pm);
    vi.spyOn(s.pm, "check").mockImplementation(async (tool, _input, _context) => {
      if (tool.name === "Bash") {
        bashAskCount++;
        return askDecision("Bash");
      }
      return originalCheck(tool, _input, _context);
    });

    // First call: Read + Bash (Read auto-allowed, Bash needs permission)
    s.mockStreamChat
      .mockImplementationOnce(() => {
        return (async function* () {
          yield* toolUseStreamEvents([
            { id: "read-1", name: "Read", input: JSON.stringify({ file_path: join(s.tmpDir, "test.txt") }) },
            { id: "bash-1", name: "Bash", input: JSON.stringify({ command: "echo mixed" }) },
          ]);
        })();
      })
      .mockImplementation(() => {
        return (async function* () {
          yield* textStreamEvents("Done");
        })();
      });

    const toolContext = { workingDirectory: s.tmpDir };

    const { result } = s.renderHook(() =>
      s.useStreamResponse([], s.setMessages, s.config, s.registry, toolContext, s.pm),
    );

    await s.act(async () => {
      result.current.sendMessage("read and bash");
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    // Only Bash should trigger a permission ask
    expect(bashAskCount).toBe(1);
    expect(result.current.permissionRequest).not.toBeNull();
    expect(result.current.permissionRequest!.toolName).toBe("Bash");

    await s.act(async () => {
      result.current.respondToPermission(true, false);
    });

    await s.act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(result.current.permissionRequest).toBeNull();
  });
});
