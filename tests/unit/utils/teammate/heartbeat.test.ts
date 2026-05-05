import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startHeartbeat,
  stopHeartbeat,
  updateHeartbeat,
  getHeartbeatStates,
  detectStaleTeammates,
  isTeammateStale,
  HEARTBEAT_TIMEOUT_MS,
} from "../../../../src/utils/teammate/heartbeat.js";

describe("heartbeat (progress-based)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Clean up any remaining heartbeats
    for (const state of getHeartbeatStates()) {
      stopHeartbeat(state.agentId);
    }
    vi.useRealTimers();
  });

  describe("startHeartbeat", () => {
    test("creates heartbeat state for a teammate", () => {
      startHeartbeat("agent-1", "alice");

      const states = getHeartbeatStates();
      expect(states).toHaveLength(1);
      expect(states[0]!.agentId).toBe("agent-1");
      expect(states[0]!.agentName).toBe("alice");
    });

    test("does not duplicate on double-start", () => {
      startHeartbeat("agent-1", "alice");
      startHeartbeat("agent-1", "alice");

      expect(getHeartbeatStates()).toHaveLength(1);
    });

    test("tracks multiple teammates independently", () => {
      startHeartbeat("agent-1", "alice");
      startHeartbeat("agent-2", "bob");

      expect(getHeartbeatStates()).toHaveLength(2);
    });
  });

  describe("stopHeartbeat", () => {
    test("removes heartbeat state", () => {
      startHeartbeat("agent-1", "alice");
      stopHeartbeat("agent-1");

      expect(getHeartbeatStates()).toHaveLength(0);
    });

    test("is safe to call on non-existent agent", () => {
      expect(() => stopHeartbeat("nonexistent")).not.toThrow();
    });

    test("only removes the specified agent", () => {
      startHeartbeat("agent-1", "alice");
      startHeartbeat("agent-2", "bob");
      stopHeartbeat("agent-1");

      const states = getHeartbeatStates();
      expect(states).toHaveLength(1);
      expect(states[0]!.agentId).toBe("agent-2");
    });
  });

  describe("updateHeartbeat", () => {
    test("updates lastProgressMs", () => {
      startHeartbeat("agent-1", "alice");
      const initial = getHeartbeatStates()[0]!.lastProgressMs;

      vi.advanceTimersByTime(5000);
      updateHeartbeat("agent-1");
      const after = getHeartbeatStates()[0]!.lastProgressMs;

      expect(after).toBeGreaterThan(initial);
    });

    test("is safe to call on non-existent agent", () => {
      expect(() => updateHeartbeat("nonexistent")).not.toThrow();
    });
  });

  describe("detectStaleTeammates", () => {
    test("returns empty when teammate has recent progress", () => {
      startHeartbeat("agent-1", "alice");

      // Simulate progress at T+30s
      vi.advanceTimersByTime(30_000);
      updateHeartbeat("agent-1");

      // Check at T+50s (20s since last progress, within 60s timeout)
      vi.advanceTimersByTime(20_000);
      expect(detectStaleTeammates()).toHaveLength(0);
    });

    test("detects stale teammate with no progress for timeout period", () => {
      startHeartbeat("agent-1", "alice");

      // No updateHeartbeat calls — simulate hung teammate
      vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + 1);

      const stale = detectStaleTeammates();
      expect(stale).toHaveLength(1);
      expect(stale[0]!.agentId).toBe("agent-1");
      expect(stale[0]!.agentName).toBe("alice");
      expect(stale[0]!.staleMs).toBeGreaterThanOrEqual(HEARTBEAT_TIMEOUT_MS);
    });

    test("does not report stopped heartbeats as stale (cleaned up)", () => {
      startHeartbeat("agent-1", "alice");
      stopHeartbeat("agent-1");

      vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + 1);

      expect(detectStaleTeammates()).toHaveLength(0);
    });

    test("only reports stale teammates, not healthy ones", () => {
      startHeartbeat("agent-1", "alice");
      startHeartbeat("agent-2", "bob");

      // Alice stops making progress (hung)
      // Bob keeps making progress
      for (let t = 0; t < HEARTBEAT_TIMEOUT_MS + 1; t += 10_000) {
        vi.advanceTimersByTime(10_000);
        updateHeartbeat("agent-2"); // bob keeps beating
      }

      const stale = detectStaleTeammates();
      expect(stale).toHaveLength(1);
      expect(stale[0]!.agentId).toBe("agent-1");
    });

    test("teammate becomes stale then recovers after progress", () => {
      startHeartbeat("agent-1", "alice");

      // Advance close to timeout
      vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1000);
      expect(detectStaleTeammates()).toHaveLength(0);

      // Make progress — resets the clock
      updateHeartbeat("agent-1");

      // Advance another 50s (total 51s since start, but only 50s since last progress)
      vi.advanceTimersByTime(50_000);
      expect(detectStaleTeammates()).toHaveLength(0);
    });
  });

  describe("isTeammateStale", () => {
    test("returns false for healthy teammate", () => {
      startHeartbeat("agent-1", "alice");
      vi.advanceTimersByTime(10_000);
      updateHeartbeat("agent-1");

      expect(isTeammateStale("agent-1")).toBe(false);
    });

    test("returns true for stale teammate", () => {
      startHeartbeat("agent-1", "alice");
      vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + 1);

      expect(isTeammateStale("agent-1")).toBe(true);
    });

    test("returns false for unknown agent", () => {
      expect(isTeammateStale("nonexistent")).toBe(false);
    });
  });

  describe("constants", () => {
    test("timeout is 60 seconds", () => {
      expect(HEARTBEAT_TIMEOUT_MS).toBe(60_000);
    });
  });
});
