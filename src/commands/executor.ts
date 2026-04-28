/**
 * Command executor for cc-study slash commands
 * Reference: free-code/src/commands.ts executeCommand logic
 *
 * Handles the full lifecycle: parse input → find command → load → execute → return result
 */

import { parseSlashCommand } from './slashCommandParser.js'
import { findCommand, getCommands } from './index.js'
import type { CommandContext } from './types.js'
import type { SkillCommand } from '../skills/types.js'

/** Result of executing a slash command or skill */
export interface CommandExecutionResult {
  /** The text output of the command/skill */
  text: string
  /** Whether this result came from a skill invocation (vs a builtin command) */
  isSkill: boolean
}

/**
 * Execute a slash command and return its result.
 * Returns null for non-slash input.
 *
 * @param input - The raw input string (should start with '/')
 * @param commandContext - Context for command execution
 * @param skills - Optional array of loaded skills to search alongside builtin commands
 */
export async function executeCommand(
  input: string,
  commandContext: CommandContext,
  skills?: SkillCommand[],
): Promise<CommandExecutionResult | null> {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) {
    return null
  }

  const parsed = parseSlashCommand(trimmed)
  if (!parsed) {
    return { text: `Unknown slash command format: ${trimmed}`, isSkill: false }
  }

  const commandName = parsed.commandName

  // Search builtin commands first
  const command = findCommand(commandName)
  if (command) {
    if (command.isEnabled && !command.isEnabled()) {
      return { text: `Command /${command.name} is currently disabled`, isSkill: false }
    }

    if (command.type === 'local') {
      const module = await command.load()
      const result = await module.call(parsed.args, commandContext)
      if (result.type === 'text') {
        return { text: result.value, isSkill: false }
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
      return capturedOutput ? { text: capturedOutput, isSkill: false } : null
    }

    if (command.type === 'prompt') {
      const blocks = await command.getPromptForCommand(parsed.args, commandContext)
      return { text: blocks.map((b) => b.text).join('\n'), isSkill: false }
    }

    return null
  }

  // Search skills if provided
  if (skills) {
    const skill = skills.find(
      (s) => s.name === commandName || s.name === parsed.commandName,
    )
    if (skill) {
      const blocks = await skill.getPromptForCommand(parsed.args, {
        abortSignal: commandContext.abortSignal,
        workingDirectory: commandContext.workingDirectory,
      })
      return { text: blocks.map((b) => b.text).join('\n'), isSkill: true }
    }
  }

  return { text: `Command not found: /${parsed.commandName}`, isSkill: false }
}

/**
 * Get all available command/skill names for help/autocomplete.
 */
export function getAllCommandNames(skills?: SkillCommand[]): string[] {
  const builtinNames = getCommands()
    .filter((cmd) => !cmd.isHidden)
    .map((cmd) => cmd.name)

  const skillNames = (skills ?? [])
    .filter((s) => s.userInvocable && !s.isHidden)
    .map((s) => s.name)

  return [...builtinNames, ...skillNames]
}
