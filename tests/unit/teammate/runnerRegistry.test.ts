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
