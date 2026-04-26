/**
 * Built-in /resume command
 * Reference: free-code/src/commands/resume/resume.tsx
 *
 * Resume a previous conversation session.
 */

import type { Command, CommandContext, LocalCommandResult } from '../types.js'

export const resumeCommand: Command = {
  type: 'local',
  name: 'resume',
  description: 'Resume a previous conversation session',
  argumentHint: '[session-id]',
  whenToUse: 'When you want to continue working on a previous conversation.',
  isEnabled: () => true,
  isHidden: false,
  userInvocable: true,
  supportsNonInteractive: true,
  load: async () => {
    return { call: resumeCall }
  },
}

async function resumeCall(
  args: string,
  context: CommandContext,
): Promise<LocalCommandResult> {
  const sessionId = args.trim()

  // If session ID is provided
  if (sessionId) {
    // Validate UUID format (basic check)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (uuidRegex.test(sessionId)) {
      // Valid UUID format - attempt to resume
      if (context.resume) {
        try {
          await context.resume(sessionId, {}, 'slash_command_session_id')
          return {
            type: 'text',
            value: `Resuming session ${sessionId}...`,
          }
        } catch {
          return {
            type: 'text',
            value: `Failed to resume session ${sessionId}. Session may not exist.`,
          }
        }
      }
      return {
        type: 'text',
        value: `Session resume functionality is not yet implemented.\nRequested session: ${sessionId}`,
      }
    }

    // Not a valid UUID - treat as search term
    return {
      type: 'text',
      value: `No session found matching "${sessionId}".\n\nNote: Full session search and resume will be available in a future update.`,
    }
  }

  // No session ID provided
  return {
    type: 'text',
    value: `# /resume

Resume a previous conversation session.

## Usage

- \`/resume [session-id]\` - Resume a specific session by ID
- \`/resume\` - Show a list of recent sessions to choose from

## Note

Full session management (list, search, resume) will be available in a future update.
Currently, you can resume a session by providing its UUID.`,
  }
}
