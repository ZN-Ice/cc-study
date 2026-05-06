/**
 * Built-in /new command (aliases: /clear, /reset)
 * Starts a fresh conversation session by clearing all messages and resetting session state.
 */

import type { Command, CommandContext, LocalCommandResult } from '../types.js'

export const clearCommand: Command = {
  type: 'local',
  name: 'new',
  aliases: ['clear', 'reset'],
  description: 'Start a new conversation session (clears all messages)',
  argumentHint: '',
  whenToUse:
    'When you want to start fresh — clears conversation history, resets cost tracking, and begins a new session.',
  isEnabled: () => true,
  isHidden: false,
  userInvocable: true,
  supportsNonInteractive: true,
  load: async () => {
    return { call: clearCall }
  },
}

async function clearCall(
  _args: string,
  context: CommandContext,
): Promise<LocalCommandResult> {
  if (!context.setMessages) {
    return {
      type: 'text',
      value: 'Cannot start new session — session state is unavailable in this context.',
    }
  }

  context.setMessages(() => [])
  context.resetSession?.()

  return {
    type: 'text',
    value:
      'Started a new conversation session. All messages cleared, cost tracking reset.',
  }
}
