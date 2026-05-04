/**
 * Registry of running async teammates.
 * Tracks background Promise executions so they can be cancelled on shutdown.
 * Also publishes completion results to the team lead's mailbox.
 */

import { writeToMailbox, createIdleNotification, TEAM_LEAD_NAME } from "../teammateMailbox.js";

interface RunnerEntry {
  agentId: string;
  agentName: string;
  teamName: string;
  abortController: AbortController;
  promise: Promise<void>;
}

const runners = new Map<string, RunnerEntry>();

export function registerRunner(entry: RunnerEntry): void {
  if (runners.has(entry.agentId)) {
    cancelRunner(entry.agentId);
  }
  runners.set(entry.agentId, entry);
}

function unregisterRunner(agentId: string): void {
  runners.delete(agentId);
}

export function cancelRunner(agentId: string): void {
  const entry = runners.get(agentId);
  if (entry) {
    entry.abortController.abort("teammate-cancelled");
    runners.delete(agentId);
  }
}

export function cancelAllRunners(): void {
  for (const [id] of runners) {
    cancelRunner(id);
  }
}

export function getRunningAgentIds(): string[] {
  return [...runners.keys()];
}

export function getRunningCount(): number {
  return runners.size;
}

export function isRunnerRunning(agentId: string): boolean {
  return runners.has(agentId);
}

/**
 * Wrap a runner promise with lifecycle hooks:
 * - Auto-unregister on completion/failure
 * - Send idle notification to team lead on completion
 * - Send error notification on failure
 */
export function withRunnerLifecycle(
  agentId: string,
  agentName: string,
  teamName: string,
  promise: Promise<{ content: string; agentType: string; totalToolUseCount: number; totalDurationMs: number }>,
): Promise<void> {
  return promise
    .then(async (result) => {
      unregisterRunner(agentId);
      // Notify team lead of completion
      try {
        const notification = createIdleNotification(agentId, {
          idleReason: "available",
          summary: `Completed: ${result.content.slice(0, 200)}`,
        });
        await writeToMailbox(
          TEAM_LEAD_NAME,
          {
            from: agentName,
            text: JSON.stringify(notification),
            timestamp: new Date().toISOString(),
          },
          teamName,
        );
      } catch {
        // Non-critical
      }
    })
    .catch(async (err) => {
      unregisterRunner(agentId);
      // Notify team lead of failure
      try {
        const notification = createIdleNotification(agentId, {
          idleReason: "failed",
          summary: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        await writeToMailbox(
          TEAM_LEAD_NAME,
          {
            from: agentName,
            text: JSON.stringify(notification),
            timestamp: new Date().toISOString(),
          },
          teamName,
        );
      } catch {
        // Non-critical
      }
    });
}
