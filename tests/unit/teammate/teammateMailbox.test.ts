import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, rm } from "node:fs/promises";
import {
  getInboxPath,
  readMailbox,
  writeToMailbox,
  markMessagesAsRead,
  clearMailbox,
  formatTeammateMessages,
  createShutdownRequestMessage,
  createShutdownApprovedMessage,
  createShutdownRejectedMessage,
  createIdleNotification,
  isIdleNotification,
  isShutdownRequest,
  isShutdownApproved,
  isShutdownRejected,
  isPlanApprovalRequest,
  isPlanApprovalResponse,
  isPermissionRequest,
  isTaskAssignment,
  TEAM_LEAD_NAME,
  readUnreadMessages,
  readTeammateResultsFromMailbox,
} from "../../../src/utils/teammateMailbox.js";

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `cc-study-tmb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("getInboxPath", () => {
  test("generates correct path with explicit teamName", () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      const path = getInboxPath("researcher", "my-team");
      expect(path).toBe(join(testDir, ".claude", "teams", "my-team", "inboxes", "researcher.json"));
    } finally {
      process.env.HOME = originalHome;
    }
  });

  test("sanitizes agent name and team name", () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      const path = getInboxPath("My Agent!", "My Team!");
      expect(path).toContain("my-team-");
      expect(path).toContain("my-agent-.json");
    } finally {
      process.env.HOME = originalHome;
    }
  });
});

describe("readMailbox", () => {
  test("returns empty array for non-existent inbox", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      const messages = await readMailbox("nonexistent", "test-team");
      expect(messages).toEqual([]);
    } finally {
      process.env.HOME = originalHome;
    }
  });
});

describe("writeToMailbox + readMailbox round-trip", () => {
  test("write then read returns written message", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      await writeToMailbox("researcher", {
        from: "lead",
        text: "Hello from lead",
        timestamp: new Date().toISOString(),
      }, "test-team");

      const messages = await readMailbox("researcher", "test-team");
      expect(messages).toHaveLength(1);
      expect(messages[0].from).toBe("lead");
      expect(messages[0].text).toBe("Hello from lead");
      expect(messages[0].read).toBe(false);
    } finally {
      process.env.HOME = originalHome;
    }
  });

  test("appends multiple messages", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      await writeToMailbox("dev", {
        from: "lead",
        text: "msg1",
        timestamp: new Date().toISOString(),
      }, "team-x");

      await writeToMailbox("dev", {
        from: "researcher",
        text: "msg2",
        timestamp: new Date().toISOString(),
      }, "team-x");

      const messages = await readMailbox("dev", "team-x");
      expect(messages).toHaveLength(2);
      expect(messages[0].text).toBe("msg1");
      expect(messages[1].text).toBe("msg2");
    } finally {
      process.env.HOME = originalHome;
    }
  });
});

describe("markMessagesAsRead", () => {
  test("marks all messages as read", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      await writeToMailbox("dev", {
        from: "lead",
        text: "hello",
        timestamp: new Date().toISOString(),
      }, "team-r");

      await writeToMailbox("dev", {
        from: "lead",
        text: "world",
        timestamp: new Date().toISOString(),
      }, "team-r");

      await markMessagesAsRead("dev", "team-r");

      const messages = await readMailbox("dev", "team-r");
      expect(messages.every((m) => m.read)).toBe(true);
    } finally {
      process.env.HOME = originalHome;
    }
  });
});

describe("readUnreadMessages", () => {
  test("returns only unread messages", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      await writeToMailbox("dev", {
        from: "lead",
        text: "unread1",
        timestamp: new Date().toISOString(),
      }, "team-u");

      await writeToMailbox("dev", {
        from: "lead",
        text: "unread2",
        timestamp: new Date().toISOString(),
      }, "team-u");

      const unread = await readUnreadMessages("dev", "team-u");
      expect(unread).toHaveLength(2);

      await markMessagesAsRead("dev", "team-u");
      const afterRead = await readUnreadMessages("dev", "team-u");
      expect(afterRead).toHaveLength(0);
    } finally {
      process.env.HOME = originalHome;
    }
  });
});

describe("clearMailbox", () => {
  test("removes all messages", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      await writeToMailbox("dev", {
        from: "lead",
        text: "to-clear",
        timestamp: new Date().toISOString(),
      }, "team-c");

      await clearMailbox("dev", "team-c");

      const messages = await readMailbox("dev", "team-c");
      expect(messages).toEqual([]);
    } finally {
      process.env.HOME = originalHome;
    }
  });
});

describe("formatTeammateMessages", () => {
  test("formats single message with teammate-message tags", () => {
    const result = formatTeammateMessages([
      { from: "researcher", text: "Found 3 bugs", timestamp: "2026-01-01T00:00:00Z" },
    ]);
    expect(result).toContain("<teammate-message");
    expect(result).toContain('teammate_id="researcher"');
    expect(result).toContain("Found 3 bugs");
    expect(result).toContain("</teammate-message>");
  });

  test("includes color attribute when provided", () => {
    const result = formatTeammateMessages([
      { from: "dev", text: "Done", timestamp: "2026-01-01T00:00:00Z", color: "#ff0000" },
    ]);
    expect(result).toContain('color="#ff0000"');
  });

  test("includes summary attribute when provided", () => {
    const result = formatTeammateMessages([
      { from: "dev", text: "Done", timestamp: "2026-01-01T00:00:00Z", summary: "Task complete" },
    ]);
    expect(result).toContain('summary="Task complete"');
  });

  test("formats multiple messages separated by double newline", () => {
    const result = formatTeammateMessages([
      { from: "a", text: "first", timestamp: "2026-01-01T00:00:00Z" },
      { from: "b", text: "second", timestamp: "2026-01-01T00:00:00Z" },
    ]);
    const parts = result.split("\n\n");
    expect(parts).toHaveLength(2);
  });

  test("returns empty string for empty array", () => {
    expect(formatTeammateMessages([])).toBe("");
  });
});

describe("TEAM_LEAD_NAME", () => {
  test('is "team-lead"', () => {
    expect(TEAM_LEAD_NAME).toBe("team-lead");
  });
});

describe("Structured message creation", () => {
  test("createShutdownRequestMessage", () => {
    const msg = createShutdownRequestMessage({
      requestId: "req-1",
      from: "lead@team",
      reason: "task complete",
    });
    expect(msg.type).toBe("shutdown_request");
    expect(msg.requestId).toBe("req-1");
    expect(msg.from).toBe("lead@team");
    expect(msg.reason).toBe("task complete");
    expect(msg.timestamp).toBeTruthy();
  });

  test("createShutdownApprovedMessage", () => {
    const msg = createShutdownApprovedMessage({
      requestId: "req-1",
      from: "worker@team",
    });
    expect(msg.type).toBe("shutdown_approved");
    expect(msg.requestId).toBe("req-1");
    expect(msg.from).toBe("worker@team");
    expect(msg.timestamp).toBeTruthy();
  });

  test("createShutdownRejectedMessage", () => {
    const msg = createShutdownRejectedMessage({
      requestId: "req-1",
      from: "worker@team",
      reason: "still working",
    });
    expect(msg.type).toBe("shutdown_rejected");
    expect(msg.reason).toBe("still working");
  });

  test("createIdleNotification", () => {
    const msg = createIdleNotification("dev@team", {
      idleReason: "available",
      summary: "Task done",
    });
    expect(msg.type).toBe("idle_notification");
    expect(msg.from).toBe("dev@team");
    expect(msg.idleReason).toBe("available");
    expect(msg.summary).toBe("Task done");
  });

  test("createIdleNotification without options", () => {
    const msg = createIdleNotification("dev@team");
    expect(msg.idleReason).toBeUndefined();
    expect(msg.summary).toBeUndefined();
  });
});

describe("Message type detection", () => {
  test("isIdleNotification detects valid message", () => {
    const msg = createIdleNotification("dev@team");
    const result = isIdleNotification(JSON.stringify(msg));
    expect(result).not.toBeNull();
    expect(result!.type).toBe("idle_notification");
    expect(result!.from).toBe("dev@team");
  });

  test("isIdleNotification returns null for non-JSON", () => {
    expect(isIdleNotification("not json")).toBeNull();
  });

  test("isIdleNotification returns null for wrong type", () => {
    expect(isIdleNotification('{"type":"other"}')).toBeNull();
  });

  test("isShutdownRequest detects valid message", () => {
    const msg = createShutdownRequestMessage({ requestId: "r1", from: "lead" });
    const result = isShutdownRequest(JSON.stringify(msg));
    expect(result).not.toBeNull();
    expect(result!.requestId).toBe("r1");
  });

  test("isShutdownRequest returns null for wrong type", () => {
    expect(isShutdownRequest('{"type":"idle_notification"}')).toBeNull();
  });

  test("isShutdownApproved detects valid message", () => {
    const msg = createShutdownApprovedMessage({ requestId: "r1", from: "w" });
    const result = isShutdownApproved(JSON.stringify(msg));
    expect(result).not.toBeNull();
    expect(result!.type).toBe("shutdown_approved");
  });

  test("isShutdownRejected detects valid message", () => {
    const msg = createShutdownRejectedMessage({ requestId: "r1", from: "w", reason: "busy" });
    const result = isShutdownRejected(JSON.stringify(msg));
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("busy");
  });

  test("isPlanApprovalRequest detects valid message", () => {
    const text = JSON.stringify({
      type: "plan_approval_request",
      from: "dev@team",
      timestamp: new Date().toISOString(),
      planFilePath: "/tmp/plan.md",
      planContent: "Step 1: ...",
      requestId: "pr-1",
    });
    const result = isPlanApprovalRequest(text);
    expect(result).not.toBeNull();
    expect(result!.planFilePath).toBe("/tmp/plan.md");
  });

  test("isPlanApprovalResponse detects valid message", () => {
    const text = JSON.stringify({
      type: "plan_approval_response",
      requestId: "pr-1",
      approved: true,
      feedback: "Looks good",
      timestamp: new Date().toISOString(),
    });
    const result = isPlanApprovalResponse(text);
    expect(result).not.toBeNull();
    expect(result!.approved).toBe(true);
  });

  test("isPermissionRequest detects valid message", () => {
    const text = JSON.stringify({
      type: "permission_request",
      request_id: "perm-1",
      agent_id: "dev@team",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      description: "Run npm test",
      input: { command: "npm test" },
    });
    const result = isPermissionRequest(text);
    expect(result).not.toBeNull();
    expect(result!.tool_name).toBe("Bash");
  });

  test("isTaskAssignment detects valid message", () => {
    const text = JSON.stringify({
      type: "task_assignment",
      taskId: "t-1",
      subject: "Fix bug",
      description: "Fix the login bug",
      assignedBy: "lead@team",
      timestamp: new Date().toISOString(),
    });
    const result = isTaskAssignment(text);
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe("t-1");
    expect(result!.subject).toBe("Fix bug");
  });

  test("all detectors return null for invalid JSON", () => {
    const invalid = "not-json{{{";
    expect(isIdleNotification(invalid)).toBeNull();
    expect(isShutdownRequest(invalid)).toBeNull();
    expect(isShutdownApproved(invalid)).toBeNull();
    expect(isShutdownRejected(invalid)).toBeNull();
    expect(isPlanApprovalRequest(invalid)).toBeNull();
    expect(isPlanApprovalResponse(invalid)).toBeNull();
    expect(isPermissionRequest(invalid)).toBeNull();
    expect(isTaskAssignment(invalid)).toBeNull();
  });

  test("all detectors return null for null JSON", () => {
    expect(isIdleNotification("null")).toBeNull();
    expect(isShutdownRequest("null")).toBeNull();
    expect(isShutdownApproved("null")).toBeNull();
  });
});

describe("readTeammateResultsFromMailbox", () => {
  test("returns empty array when no unread messages exist", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      const results = await readTeammateResultsFromMailbox("empty-team");
      expect(results).toEqual([]);
    } finally {
      process.env.HOME = originalHome;
    }
  });

  test("returns teammate_completion message content", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      const completionMsg = JSON.stringify({
        type: "teammate_completion",
        agentId: "searcher@team-a",
        agentName: "searcher",
        content: "Found 42 bugs in the codebase",
        agentType: "Explore",
        toolUseCount: 5,
        durationMs: 3000,
      });
      await writeToMailbox(TEAM_LEAD_NAME, {
        from: "searcher",
        text: completionMsg,
        timestamp: new Date().toISOString(),
        summary: "[result] searcher completed",
      }, "team-a");

      const results = await readTeammateResultsFromMailbox("team-a");
      expect(results).toHaveLength(1);
      expect(results[0].agentName).toBe("searcher");
      expect(results[0].content).toBe("Found 42 bugs in the codebase");
      expect(results[0].agentType).toBe("Explore");
      expect(results[0].toolUseCount).toBe(5);
      expect(results[0].durationMs).toBe(3000);
    } finally {
      process.env.HOME = originalHome;
    }
  });

  test("reads multiple completion messages", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      await writeToMailbox(TEAM_LEAD_NAME, {
        from: "researcher",
        text: JSON.stringify({
          type: "teammate_completion",
          agentId: "researcher@team-b",
          agentName: "researcher",
          content: "Research results",
          agentType: "Explore",
          toolUseCount: 3,
          durationMs: 2000,
        }),
        timestamp: new Date().toISOString(),
      }, "team-b");

      await writeToMailbox(TEAM_LEAD_NAME, {
        from: "coder",
        text: JSON.stringify({
          type: "teammate_completion",
          agentId: "coder@team-b",
          agentName: "coder",
          content: "Code written",
          agentType: "general-purpose",
          toolUseCount: 10,
          durationMs: 5000,
        }),
        timestamp: new Date().toISOString(),
      }, "team-b");

      const results = await readTeammateResultsFromMailbox("team-b");
      expect(results).toHaveLength(2);
      expect(results[0].agentName).toBe("researcher");
      expect(results[0].content).toBe("Research results");
      expect(results[1].agentName).toBe("coder");
      expect(results[1].content).toBe("Code written");
    } finally {
      process.env.HOME = originalHome;
    }
  });

  test("returns idle notification with Completed: prefix as fallback", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      const idleMsg = createIdleNotification("searcher@team-c", {
        idleReason: "available",
        summary: "Completed: Found 5 issues",
      });
      await writeToMailbox(TEAM_LEAD_NAME, {
        from: "searcher",
        text: JSON.stringify(idleMsg),
        timestamp: new Date().toISOString(),
      }, "team-c");

      const results = await readTeammateResultsFromMailbox("team-c");
      expect(results).toHaveLength(1);
      expect(results[0].agentName).toBe("searcher");
      expect(results[0].content).toBe("Found 5 issues");
    } finally {
      process.env.HOME = originalHome;
    }
  });

  test("marks messages as read after reading", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      await writeToMailbox(TEAM_LEAD_NAME, {
        from: "searcher",
        text: JSON.stringify({
          type: "teammate_completion",
          agentId: "searcher@team-d",
          agentName: "searcher",
          content: "Done",
          agentType: "Explore",
          toolUseCount: 0,
          durationMs: 0,
        }),
        timestamp: new Date().toISOString(),
      }, "team-d");

      await readTeammateResultsFromMailbox("team-d");
      const remaining = await readUnreadMessages(TEAM_LEAD_NAME, "team-d");
      expect(remaining).toHaveLength(0);
    } finally {
      process.env.HOME = originalHome;
    }
  });

  test("skips non-completion messages", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      await writeToMailbox(TEAM_LEAD_NAME, {
        from: "searcher",
        text: "plain text message",
        timestamp: new Date().toISOString(),
      }, "team-e");

      const results = await readTeammateResultsFromMailbox("team-e");
      expect(results).toEqual([]);
    } finally {
      process.env.HOME = originalHome;
    }
  });

  test("handles teammate_completion with 10000+ char content (no truncation)", async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = testDir;
    try {
      const longContent = "A".repeat(15000);
      await writeToMailbox(TEAM_LEAD_NAME, {
        from: "big-results",
        text: JSON.stringify({
          type: "teammate_completion",
          agentId: "big@team-f",
          agentName: "big-results",
          content: longContent,
          agentType: "general-purpose",
          toolUseCount: 100,
          durationMs: 60000,
        }),
        timestamp: new Date().toISOString(),
      }, "team-f");

      const results = await readTeammateResultsFromMailbox("team-f");
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe(longContent);
      expect(results[0].content.length).toBe(15000);
    } finally {
      process.env.HOME = originalHome;
    }
  });
});
