/**
 * Command Registry for cc-study
 * Reference: free-code/src/commands.ts
 */

import type { Command } from './types.js'
import { getCommandName, isCommandEnabled } from './types.js'
import { helpCommand } from './builtins/help.js'
import { compactCommand } from './builtins/compact.js'
import { configCommand } from './builtins/config.js'
import { resumeCommand } from './builtins/resume.js'
import { memoryCommand } from './builtins/memory.js'

// Built-in commands registered by default
const BUILTIN_COMMANDS: Command[] = [
  helpCommand,
  compactCommand,
  configCommand,
  resumeCommand,
  memoryCommand,
]

/**
 * Get all available commands
 */
export function getCommands(): Command[] {
  return [...BUILTIN_COMMANDS]
}

/**
 * Find a command by name or alias
 */
export function findCommand(
  commandName: string,
  commands: Command[] = BUILTIN_COMMANDS,
): Command | undefined {
  return commands.find(
    (cmd) =>
      cmd.name === commandName ||
      getCommandName(cmd) === commandName ||
      cmd.aliases?.includes(commandName),
  )
}

/**
 * Check if a command exists
 */
export function hasCommand(
  commandName: string,
  commands: Command[] = BUILTIN_COMMANDS,
): boolean {
  return findCommand(commandName, commands) !== undefined
}

/**
 * Get a command by name, throw if not found
 */
export function getCommand(
  commandName: string,
  commands: Command[] = BUILTIN_COMMANDS,
): Command {
  const command = findCommand(commandName, commands)
  if (!command) {
    const available = commands
      .map((cmd) => {
        const name = getCommandName(cmd)
        return cmd.aliases ? `${name} (aliases: ${cmd.aliases.join(', ')})` : name
      })
      .sort((a, b) => a.localeCompare(b))
      .join(', ')
    throw new ReferenceError(
      `Command ${commandName} not found. Available commands: ${available}`,
    )
  }
  return command
}

/**
 * Filter commands by availability requirement
 */
export function meetsAvailabilityRequirement(cmd: Command): boolean {
  if (!cmd.availability) return true
  // For now, cc-study doesn't have auth provider checks
  // This is a placeholder for future expansion
  return true
}

/**
 * Get enabled commands filtered by availability and isEnabled
 */
export function getEnabledCommands(): Command[] {
  return BUILTIN_COMMANDS.filter(
    (cmd) =>
      meetsAvailabilityRequirement(cmd) && isCommandEnabled(cmd),
  )
}

// Re-export types
export type {
  Command,
  CommandBase,
  CommandContext,
  LocalCommandResult,
  PromptCommand,
  LocalCommand,
  LocalJSXCommand,
  ResumeEntrypoint,
  CommandResultDisplay,
  SubCommand,
} from './types.js'

export { getCommandName, isCommandEnabled } from './types.js'
