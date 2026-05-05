import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { getTeamName } from "./teammate.js";

const TEAM_LEAD_NAME = "team-lead";
const TEAMMATE_MESSAGE_TAG = "teammate-message";

// Simplified: use getTeamsDir from env, fallback to ~/.claude/teams/
function getTeamsDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return join(home, ".claude", "teams");
}

function sanitizePathComponent(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}

// ──────────────────────────────────────────────
// TeammateMessage type
// ──────────────────────────────────────────────

export interface TeammateMessage {
  from: string;
  text: string;
  timestamp: string;
  read: boolean;
  color?: string;
  summary?: string;
}

// ──────────────────────────────────────────────
// Inbox path
// ──────────────────────────────────────────────

export function getInboxPath(agentName: string, teamName?: string): string {
  const team = teamName ?? getTeamName() ?? "default";
  const safeTeam = sanitizePathComponent(team);
  const safeAgentName = sanitizePathComponent(agentName);
  const inboxDir = join(getTeamsDir(), safeTeam, "inboxes");
  return join(inboxDir, `${safeAgentName}.json`);
}

async function ensureInboxDir(teamName?: string): Promise<void> {
  const team = teamName ?? getTeamName() ?? "default";
  const safeTeam = sanitizePathComponent(team);
  const inboxDir = join(getTeamsDir(), safeTeam, "inboxes");
  await mkdir(inboxDir, { recursive: true });
}

// ──────────────────────────────────────────────
// Read
// ──────────────────────────────────────────────

export async function readMailbox(
  agentName: string,
  teamName?: string,
): Promise<TeammateMessage[]> {
  const inboxPath = getInboxPath(agentName, teamName);
  try {
    const content = await readFile(inboxPath, "utf-8");
    return JSON.parse(content) as TeammateMessage[];
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return [];
    return [];
  }
}

export async function readUnreadMessages(
  agentName: string,
  teamName?: string,
): Promise<TeammateMessage[]> {
  const messages = await readMailbox(agentName, teamName);
  return messages.filter((m) => !m.read);
}

// ──────────────────────────────────────────────
// Write (with per-path lock to prevent race conditions)
// ──────────────────────────────────────────────

/** Per-inbox-path lock to serialize concurrent writes. */
const inboxLocks = new Map<string, Promise<void>>();

async function withInboxLock<T>(inboxPath: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any previous operation on this path to finish
  const prev = inboxLocks.get(inboxPath);
  if (prev) await prev.catch(() => {});

  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  inboxLocks.set(inboxPath, current);

  try {
    return await fn();
  } finally {
    release();
    if (inboxLocks.get(inboxPath) === current) {
      inboxLocks.delete(inboxPath);
    }
  }
}

export async function writeToMailbox(
  recipientName: string,
  message: Omit<TeammateMessage, "read">,
  teamName?: string,
): Promise<void> {
  await ensureInboxDir(teamName);
  const inboxPath = getInboxPath(recipientName, teamName);

  await withInboxLock(inboxPath, async () => {
    // Ensure file exists
    try {
      await writeFile(inboxPath, "[]", { encoding: "utf-8", flag: "wx" });
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") {
        return;
      }
    }

    // Read current messages, append, write back
    const messages = await readMailbox(recipientName, teamName);
    const newMessage: TeammateMessage = { ...message, read: false };
    messages.push(newMessage);
    await writeFile(inboxPath, JSON.stringify(messages, null, 2), "utf-8");
  });
}

// ──────────────────────────────────────────────
// Mark as read
// ──────────────────────────────────────────────

export async function markMessagesAsRead(
  agentName: string,
  teamName?: string,
): Promise<void> {
  const inboxPath = getInboxPath(agentName, teamName);
  try {
    const content = await readFile(inboxPath, "utf-8");
    const messages = JSON.parse(content) as TeammateMessage[];
    for (const m of messages) {
      m.read = true;
    }
    await writeFile(inboxPath, JSON.stringify(messages, null, 2), "utf-8");
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
  }
}

export async function markMessageAsReadByIndex(
  agentName: string,
  teamName: string | undefined,
  messageIndex: number,
): Promise<void> {
  const inboxPath = getInboxPath(agentName, teamName);
  try {
    const content = await readFile(inboxPath, "utf-8");
    const messages = JSON.parse(content) as TeammateMessage[];
    if (messageIndex >= 0 && messageIndex < messages.length) {
      messages[messageIndex] = { ...messages[messageIndex], read: true };
      await writeFile(inboxPath, JSON.stringify(messages, null, 2), "utf-8");
    }
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
  }
}

// ──────────────────────────────────────────────
// Clear
// ──────────────────────────────────────────────

export async function clearMailbox(
  agentName: string,
  teamName?: string,
): Promise<void> {
  const inboxPath = getInboxPath(agentName, teamName);
  try {
    await writeFile(inboxPath, "[]", { encoding: "utf-8", flag: "r+" });
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
  }
}

// ──────────────────────────────────────────────
// Format for display
// ──────────────────────────────────────────────

export function formatTeammateMessages(
  messages: Array<{
    from: string;
    text: string;
    timestamp: string;
    color?: string;
    summary?: string;
  }>,
): string {
  return messages
    .map((m) => {
      const colorAttr = m.color ? ` color="${m.color}"` : "";
      const summaryAttr = m.summary ? ` summary="${m.summary}"` : "";
      return `<${TEAMMATE_MESSAGE_TAG} teammate_id="${m.from}"${colorAttr}${summaryAttr}>\n${m.text}\n</${TEAMMATE_MESSAGE_TAG}>`;
    })
    .join("\n\n");
}

// ──────────────────────────────────────────────
// Read teammate results from the team lead's mailbox
// ──────────────────────────────────────────────

export interface TeammateCompletionResult {
  readonly agentName: string;
  readonly content: string;
  readonly agentType: string;
  readonly toolUseCount: number;
  readonly durationMs: number;
}

/**
 * Read unread completion results from the team lead's mailbox.
 *
 * Looks for two types of messages:
 * - `type === "teammate_completion"` (full result message written by withRunnerLifecycle)
 * - idle_notification messages with a summary starting with "Completed:" (fallback)
 *
 * Returns an array of (agentName, content) pairs and marks the messages as read.
 */
export async function readTeammateResultsFromMailbox(
  teamName: string,
): Promise<TeammateCompletionResult[]> {
  const inboxPath = getInboxPath(TEAM_LEAD_NAME, teamName);

  // Serialize with writeToMailbox to prevent lost writes:
  // Without this lock, a concurrent writeToMailbox could append a new
  // message between our read and our write-back, and our write-back
  // would silently drop it.
  return withInboxLock(inboxPath, async () => {
    const messages = await readMailbox(TEAM_LEAD_NAME, teamName);
    const unread = messages.filter((m) => !m.read);
    if (unread.length === 0) return [];

    const results: TeammateCompletionResult[] = [];
    const readIndices: number[] = [];

    for (let i = 0; i < messages.length; i++) {
      if (messages[i]!.read) continue;

      try {
        const parsed = JSON.parse(messages[i]!.text);
        if (parsed.type === "teammate_completion") {
          results.push({
            agentName: parsed.agentName ?? messages[i]!.from,
            content: parsed.content ?? "",
            agentType: parsed.agentType ?? "teammate",
            toolUseCount: parsed.toolUseCount ?? 0,
            durationMs: parsed.durationMs ?? 0,
          });
          readIndices.push(i);
        } else if (parsed.type === "idle_notification" && parsed.summary?.startsWith("Completed:")) {
          const content = parsed.summary.slice("Completed:".length).trim();
          results.push({
            agentName: messages[i]!.from,
            content,
            agentType: "teammate",
            toolUseCount: 0,
            durationMs: 0,
          });
          readIndices.push(i);
        }
      } catch {
        // Not JSON — skip
      }
    }

    // Mark read messages
    for (const idx of readIndices) {
      messages[idx] = { ...messages[idx]!, read: true };
    }
    if (readIndices.length > 0) {
      try {
        await writeFile(inboxPath, JSON.stringify(messages, null, 2), "utf-8");
      } catch {
        // Non-critical
      }
    }

    return results;
  });
}

// ──────────────────────────────────────────────
// Structured protocol messages
// ──────────────────────────────────────────────

export interface IdleNotificationMessage {
  type: "idle_notification";
  from: string;
  timestamp: string;
  idleReason?: "available" | "interrupted" | "failed";
  summary?: string;
}

export interface ShutdownRequestMessage {
  type: "shutdown_request";
  requestId: string;
  from: string;
  reason?: string;
  timestamp: string;
}

export interface ShutdownApprovedMessage {
  type: "shutdown_approved";
  requestId: string;
  from: string;
  timestamp: string;
}

export interface ShutdownRejectedMessage {
  type: "shutdown_rejected";
  requestId: string;
  from: string;
  reason: string;
  timestamp: string;
}

export interface PlanApprovalRequestMessage {
  type: "plan_approval_request";
  from: string;
  timestamp: string;
  planFilePath: string;
  planContent: string;
  requestId: string;
}

export interface PlanApprovalResponseMessage {
  type: "plan_approval_response";
  requestId: string;
  approved: boolean;
  feedback?: string;
  timestamp: string;
}

export interface TaskAssignmentMessage {
  type: "task_assignment";
  taskId: string;
  subject: string;
  description: string;
  assignedBy: string;
  timestamp: string;
}

export interface PermissionRequestMessage {
  type: "permission_request";
  request_id: string;
  agent_id: string;
  tool_name: string;
  tool_use_id: string;
  description: string;
  input: Record<string, unknown>;
}

export function createShutdownRequestMessage(params: {
  requestId: string;
  from: string;
  reason?: string;
}): ShutdownRequestMessage {
  return {
    type: "shutdown_request",
    requestId: params.requestId,
    from: params.from,
    reason: params.reason,
    timestamp: new Date().toISOString(),
  };
}

export function createShutdownApprovedMessage(params: {
  requestId: string;
  from: string;
}): ShutdownApprovedMessage {
  return {
    type: "shutdown_approved",
    requestId: params.requestId,
    from: params.from,
    timestamp: new Date().toISOString(),
  };
}

export function createShutdownRejectedMessage(params: {
  requestId: string;
  from: string;
  reason: string;
}): ShutdownRejectedMessage {
  return {
    type: "shutdown_rejected",
    requestId: params.requestId,
    from: params.from,
    reason: params.reason,
    timestamp: new Date().toISOString(),
  };
}

export function createIdleNotification(
  agentId: string,
  options?: {
    idleReason?: IdleNotificationMessage["idleReason"];
    summary?: string;
  },
): IdleNotificationMessage {
  return {
    type: "idle_notification",
    from: agentId,
    timestamp: new Date().toISOString(),
    idleReason: options?.idleReason,
    summary: options?.summary,
  };
}

// ──────────────────────────────────────────────
// Message type detection helpers
// ──────────────────────────────────────────────

export function isIdleNotification(
  messageText: string,
): IdleNotificationMessage | null {
  try {
    const parsed = JSON.parse(messageText);
    if (parsed?.type === "idle_notification") {
      return parsed as IdleNotificationMessage;
    }
  } catch {
    // Not JSON
  }
  return null;
}

export function isShutdownRequest(
  messageText: string,
): ShutdownRequestMessage | null {
  try {
    const parsed = JSON.parse(messageText);
    if (parsed?.type === "shutdown_request") {
      return parsed as ShutdownRequestMessage;
    }
  } catch {
    // Not JSON
  }
  return null;
}

export function isShutdownApproved(
  messageText: string,
): ShutdownApprovedMessage | null {
  try {
    const parsed = JSON.parse(messageText);
    if (parsed?.type === "shutdown_approved") {
      return parsed as ShutdownApprovedMessage;
    }
  } catch {
    // Not JSON
  }
  return null;
}

export function isShutdownRejected(
  messageText: string,
): ShutdownRejectedMessage | null {
  try {
    const parsed = JSON.parse(messageText);
    if (parsed?.type === "shutdown_rejected") {
      return parsed as ShutdownRejectedMessage;
    }
  } catch {
    // Not JSON
  }
  return null;
}

export function isPlanApprovalRequest(
  messageText: string,
): PlanApprovalRequestMessage | null {
  try {
    const parsed = JSON.parse(messageText);
    if (parsed?.type === "plan_approval_request") {
      return parsed as PlanApprovalRequestMessage;
    }
  } catch {
    // Not JSON
  }
  return null;
}

export function isPlanApprovalResponse(
  messageText: string,
): PlanApprovalResponseMessage | null {
  try {
    const parsed = JSON.parse(messageText);
    if (parsed?.type === "plan_approval_response") {
      return parsed as PlanApprovalResponseMessage;
    }
  } catch {
    // Not JSON
  }
  return null;
}

export function isPermissionRequest(
  messageText: string,
): PermissionRequestMessage | null {
  try {
    const parsed = JSON.parse(messageText);
    if (parsed?.type === "permission_request") {
      return parsed as PermissionRequestMessage;
    }
  } catch {
    // Not JSON
  }
  return null;
}

export function isTaskAssignment(
  messageText: string,
): TaskAssignmentMessage | null {
  try {
    const parsed = JSON.parse(messageText);
    if (parsed?.type === "task_assignment") {
      return parsed as TaskAssignmentMessage;
    }
  } catch {
    // Not JSON
  }
  return null;
}

export { TEAM_LEAD_NAME };
