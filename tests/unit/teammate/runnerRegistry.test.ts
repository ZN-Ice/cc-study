import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  registerRunner,
  cancelRunner,
  cancelAllRunners,
  getRunningAgentIds,
  getRunningCount,
  isRunnerRunning,
  withRunnerLifecycle,
} from "../../../src/utils/teammate/runnerRegistry.js";

// Mock mailbox writes
vi.mock("../../../src/utils/teammateMailbox.js", () => ({
  writeToMailbox: vi.fn(),
  createIdleNotification: vi.fn((agentId, opts) => ({
    type: "idle_notification",
    from: agentId,
    timestamp: new Date().toISOString(),
    idleReason: opts?.idleReason,
    summary: opts?.summary,
  })),
  TEAM_LEAD_NAME: "team-lead",
}));

import { writeToMailbox } from "../../../src/utils/teammateMailbox.js";
const mockedWriteToMailbox = vi.mocked(writeToMailbox);

function createMockRunner(agentId: string, agentName = "test", teamName = "test-team") {
  const abortController = new AbortController();
  const promise = Promise.resolve({
    content: "Done",
    agentType: "general-purpose",
    totalToolUseCount: 3,
    totalDurationMs: 1000,
  });
  return {
    agentId,
    agentName,
    teamName,
    abortController,
    promise,
  };
}

describe("TeammateRunnerRegistry", () => {
  beforeEach(() => {
    cancelAllRunners();
    mockedWriteToMailbox.mockClear();
  });

  describe("registerRunner", () => {
    test("registers a runner and tracks it", () => {
      const entry = createMockRunner("agent-1@team");
      registerRunner(entry);
      expect(getRunningCount()).toBe(1);
      expect(isRunnerRunning("agent-1@team")).toBe(true);
      expect(getRunningAgentIds()).toContain("agent-1@team");
    });

    test("replaces existing runner with same agentId", () => {
      const first = createMockRunner("agent-1@team");
      registerRunner(first);

      const second = createMockRunner("agent-1@team", "different-name");
      registerRunner(second);

      expect(getRunningCount()).toBe(1);
    });
  });

  describe("cancelRunner", () => {
    test("cancels and removes runner", () => {
      const entry = createMockRunner("agent-1@team");
      registerRunner(entry);

      cancelRunner("agent-1@team");

      expect(isRunnerRunning("agent-1@team")).toBe(false);
      expect(getRunningCount()).toBe(0);
      expect(entry.abortController.signal.aborted).toBe(true);
    });

    test("no-ops for unknown agentId", () => {
      expect(() => cancelRunner("nonexistent")).not.toThrow();
    });
  });

  describe("cancelAllRunners", () => {
    test("cancels all registered runners", () => {
      const a = createMockRunner("a@team");
      const b = createMockRunner("b@team");
      registerRunner(a);
      registerRunner(b);

      cancelAllRunners();

      expect(getRunningCount()).toBe(0);
      expect(getRunningAgentIds()).toHaveLength(0);
    });

    test("abort controllers are triggered when cancelAllRunners is called", async () => {
      // Simulate a running teammate that doesn't complete
      const abortController = new AbortController();

      const longRunningPromise = new Promise<{
        content: string;
        agentType: string;
        totalToolUseCount: number;
        totalDurationMs: number;
      }>((resolve) => {
        // This promise never resolves on its own
        abortController.signal.addEventListener("abort", () => {
          resolve({
            content: "Cancelled",
            agentType: "teammate",
            totalToolUseCount: 0,
            totalDurationMs: 100,
          });
        });
      });

      const wrappedPromise = withRunnerLifecycle(
        "cancellable@team",
        "cancellable",
        "test-team",
        longRunningPromise,
      );

      registerRunner({
        agentId: "cancellable@team",
        agentName: "cancellable",
        teamName: "test-team",
        abortController,
        promise: wrappedPromise,
      });

      // Verify runner is registered
      expect(isRunnerRunning("cancellable@team")).toBe(true);

      // Simulate app exit: call cancelAllRunners
      cancelAllRunners();

      // Abort controller should be triggered
      expect(abortController.signal.aborted).toBe(true);

      // Wait for the wrapped promise to resolve
      await wrappedPromise;

      // Runner should be unregistered after completion
      expect(isRunnerRunning("cancellable@team")).toBe(false);
    });
  });

  describe("withRunnerLifecycle", () => {
    test("unregisters on successful completion", async () => {
      const entry = createMockRunner("agent-1@team");
      const wrappedPromise = withRunnerLifecycle(
        entry.agentId,
        entry.agentName,
        entry.teamName,
        entry.promise,
      );

      // Register + wait for lifecycle to complete
      registerRunner({ ...entry, promise: wrappedPromise });
      expect(getRunningCount()).toBe(1);

      await wrappedPromise;

      // Should be unregistered after completion
      expect(getRunningCount()).toBe(0);
    });

    test("writes full result content without 200-char truncation", async () => {
      const longContent = "Line of text\n".repeat(500); // ~7000 chars
      const longPromise = Promise.resolve({
        content: longContent,
        agentType: "general-purpose",
        totalToolUseCount: 5,
        totalDurationMs: 3000,
      });
      const wrappedPromise = withRunnerLifecycle(
        "long@team",
        "long-runner",
        "team-g",
        longPromise,
      );
      await wrappedPromise;

      // Called twice: idle notification + teammate_completion
      expect(mockedWriteToMailbox).toHaveBeenCalledTimes(2);

      // writeToMailbox signature: (recipientName, message, teamName)
      // message = { from, text, timestamp, summary }
      // First call (idle notification): message.text should contain full summary
      const firstCallMessage = mockedWriteToMailbox.mock.calls[0]![1]!;
      const firstText = firstCallMessage.text;
      const firstParsed = JSON.parse(firstText);
      expect(firstParsed.summary).toContain("Completed:");
      // The summary content should contain the full text (only capped at 10000)
      expect(firstParsed.summary.length).toBeGreaterThan(200);

      // Second call (teammate_completion): message.text should contain the full result
      const secondCallMessage = mockedWriteToMailbox.mock.calls[1]![1]!;
      const secondText = secondCallMessage.text;
      const secondParsed = JSON.parse(secondText);
      expect(secondParsed.type).toBe("teammate_completion");
      expect(secondParsed.content).toBe(longContent);
      expect(secondParsed.content.length).toBeGreaterThan(6000);
    });

    test("writes teammate_completion message on success", async () => {
      const entry = createMockRunner("agent-1@team");
      const wrappedPromise = withRunnerLifecycle(
        entry.agentId,
        entry.agentName,
        entry.teamName,
        entry.promise,
      );
      registerRunner({ ...entry, promise: wrappedPromise });
      await wrappedPromise;

      // Should write both idle notification and teammate_completion
      expect(mockedWriteToMailbox).toHaveBeenCalledTimes(2);

      // writeToMailbox signature: (recipientName, message, teamName)
      // message = { from, text, timestamp }
      const secondCallMessage = mockedWriteToMailbox.mock.calls[1]![1]!;
      const secondText = secondCallMessage.text;
      const parsed = JSON.parse(secondText);
      expect(parsed.type).toBe("teammate_completion");
      expect(parsed.agentName).toBe("test");
      expect(parsed.content).toBe("Done");
      expect(parsed.agentType).toBe("general-purpose");
      expect(parsed.toolUseCount).toBe(3);
    });

    test("unregisters on failure", async () => {
      const failingPromise = Promise.reject(new Error("Boom"));
      const wrappedPromise = withRunnerLifecycle(
        "fail@team",
        "failer",
        "team",
        failingPromise,
      );

      // Register with the wrapped promise
      const controller = new AbortController();
      registerRunner({
        agentId: "fail@team",
        agentName: "failer",
        teamName: "team",
        abortController: controller,
        promise: wrappedPromise,
      });
      expect(getRunningCount()).toBe(1);

      await wrappedPromise.catch(() => {});

      // Should be unregistered after failure
      expect(getRunningCount()).toBe(0);
    });
  });
});