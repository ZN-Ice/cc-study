/**
 * Registry of running async teammates.
 * Tracks background Promise executions so they can be cancelled on shutdown.
 * Also publishes completion results to the team lead's mailbox.
 */

import { writeToMailbox, createIdleNotification, TEAM_LEAD_NAME } from "../teammateMailbox.js";
import { readTeamFile, writeTeamFileSync } from "../teamHelper.js";

/** Maximum length for the summary field in an idle notification. */
const SUMMARY_MAX_LENGTH = 10_000;

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
      // Remove teammate from team.json members list
      removeFromTeamFile(teamName, agentName);
      // Notify team lead of completion
      try {
        // 1. Send an idle notification with a generous summary
        const summary = result.content.length > SUMMARY_MAX_LENGTH
          ? result.content.slice(0, SUMMARY_MAX_LENGTH) + "\n\n...(truncated)"
          : result.content;
        const notification = createIdleNotification(agentId, {
          idleReason: "available",
          summary: `Completed: ${summary}`,
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

        // 2. Also send a dedicated completion message with the FULL result
        //    so the team lead can read the complete output regardless of
        //    summary truncation.
        const completionMsg = JSON.stringify({
          type: "teammate_completion",
          agentId,
          agentName,
          content: result.content,
          agentType: result.agentType,
          toolUseCount: result.totalToolUseCount,
          durationMs: result.totalDurationMs,
        });
        await writeToMailbox(
          TEAM_LEAD_NAME,
          {
            from: agentName,
            text: completionMsg,
            timestamp: new Date().toISOString(),
            summary: `[result] ${agentName} completed — ${result.content.length} chars`,
          },
          teamName,
        );
      } catch {
        // Non-critical
      }
    })
    .catch(async (err) => {
      unregisterRunner(agentId);
      // Remove teammate from team.json members list
      removeFromTeamFile(teamName, agentName);
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

/**
 * Remove a teammate from the team.json members list.
 * Called when a teammate completes or fails.
 */
function removeFromTeamFile(teamName: string, agentName: string): void {
  try {
    const teamFile = readTeamFile(teamName);
    if (teamFile) {
      const initialLength = teamFile.members.length;
      teamFile.members = teamFile.members.filter((m) => m.name !== agentName);
      if (teamFile.members.length !== initialLength) {
        writeTeamFileSync(teamName, teamFile);
      }
    }
  } catch {
    // Non-critical: team.json update failure should not affect teammate lifecycle
  }
}
