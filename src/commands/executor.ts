/**
 * Command executor for cc-study slash commands
 * Reference: free-code/src/commands.ts executeCommand logic
 *
 * Handles the full lifecycle: parse input → find command → load → execute → return result
 */

import { parseSlashCommand } from './slashCommandParser.js'
import { findCommand } from './index.js'
import type { CommandContext } from './types.js'

/**
 * Execute a slash command and return its text output.
 * Returns null if the command produces no text output (e.g., skips display).
 */
export async function executeCommand(
  input: string,
  commandContext: CommandContext,
): Promise<string | null> {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) {
    return null
  }

  const parsed = parseSlashCommand(trimmed)
  if (!parsed) {
    return `Unknown slash command format: ${trimmed}`
  }

  const command = findCommand(parsed.commandName)
  if (!command) {
    return `Command not found: /${parsed.commandName}`
  }

  if (command.isEnabled && !command.isEnabled()) {
    return `Command /${command.name} is currently disabled`
  }

  if (command.type === 'local') {
    const module = await command.load()
    const result = await module.call(parsed.args, commandContext)
    if (result.type === 'text') {
      return result.value
    }
    return null
  }

  if (command.type === 'local-jsx') {
    const module = await command.load()
    let capturedOutput: string | undefined
    await module.call(
      (output?: string) => {
        capturedOutput = output
      },
      commandContext,
      parsed.args,
    )
    return capturedOutput ?? null
  }

  if (command.type === 'prompt') {
    return `Command /${command.name} is not yet implemented for direct invocation`
  }

  return null
}
