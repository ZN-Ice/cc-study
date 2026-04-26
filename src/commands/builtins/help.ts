/**
 * Built-in /help command
 * Reference: free-code/src/commands/help/help.tsx
 */

import type { Command, CommandContext } from '../types.js'
import { getCommands, getCommandName } from '../index.js'

export const helpCommand: Command = {
  type: 'local-jsx',
  name: 'help',
  description: 'Show available commands and their descriptions',
  argumentHint: '[command]',
  whenToUse: 'When you want to see what commands are available or learn about a specific command.',
  isEnabled: () => true,
  isHidden: false,
  userInvocable: true,
  load: async () => {
    return { call: helpCall }
  },
}

async function helpCall(
  onDone: (result?: string) => void,
  _context: CommandContext,
  args: string,
): Promise<React.ReactNode> {
  const commands = getCommands()
  const normalizedArgs = args?.trim()?.toLowerCase() ?? ''

  // If a specific command is requested
  if (normalizedArgs) {
    const targetCmd = commands.find(
      (cmd) =>
        cmd?.name?.toLowerCase() === normalizedArgs ||
        cmd?.aliases?.some((a) => a.toLowerCase() === normalizedArgs),
    )

    if (targetCmd) {
      const lines: string[] = []
      lines.push(`# /${getCommandName(targetCmd)}`)
      if (targetCmd.aliases && targetCmd.aliases.length > 0) {
        lines.push(`**Aliases**: ${targetCmd.aliases.map((a) => `/${a}`).join(', ')}`)
      }
      lines.push('')
      lines.push(targetCmd.description)
      if (targetCmd.argumentHint) {
        lines.push('')
        lines.push(`**Usage**: /${getCommandName(targetCmd)} ${targetCmd.argumentHint}`)
      }
      if (targetCmd.whenToUse) {
        lines.push('')
        lines.push(`**When to use**: ${targetCmd.whenToUse}`)
      }

      onDone(lines.join('\n'))
      return null
    } else {
      onDone(`Command "${normalizedArgs}" not found. Use /help to see available commands.`)
      return null
    }
  }

  // Show all commands
  const lines: string[] = []
  lines.push('# Available Commands')
  lines.push('')

  const visibleCommands = commands.filter((cmd) => !cmd?.isHidden && cmd?.userInvocable)

  for (const cmd of visibleCommands) {
    if (!cmd) continue
    const name = getCommandName(cmd)
    const desc = cmd.description ?? '(no description)'
    lines.push(`- **/${name}** - ${desc}`)
  }

  lines.push('')
  lines.push('Use `/help [command]` to learn more about a specific command.')

  onDone(lines.join('\n'))
  return null
}
