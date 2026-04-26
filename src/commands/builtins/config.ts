/**
 * Built-in /config command
 * Reference: free-code/src/commands/config/config.tsx
 *
 * Opens the configuration settings UI.
 * In cc-study CLI, we output configuration as text instead of rendering a full UI.
 */

import type { Command, CommandContext, LocalCommandResult, SubCommand } from '../types.js'

const configSubCommands: SubCommand[] = [
  { name: 'permissionMode', description: 'Permission mode (allow/deny/ask)' },
  { name: 'model', description: 'Default model to use' },
  { name: 'maxTokens', description: 'Maximum tokens per response' },
  { name: 'temperature', description: 'Response temperature' },
]

export const configCommand: Command = {
  type: 'local',
  name: 'config',
  description: 'Show and edit configuration settings',
  argumentHint: '[key]',
  whenToUse: 'When you want to view or modify your Claude Code settings.',
  isEnabled: () => true,
  isHidden: false,
  userInvocable: true,
  supportsNonInteractive: true,
  subCommands: configSubCommands,
  load: async () => {
    return { call: configCall }
  },
}

async function configCall(
  args: string,
  _context: CommandContext,
): Promise<LocalCommandResult> {
  const normalizedArgs = args.trim().toLowerCase()

  // If a specific config key is requested
  if (normalizedArgs) {
    return {
      type: 'text',
      value: getConfigValue(normalizedArgs),
    }
  }

  // Show all config
  return {
    type: 'text',
    value: buildConfigOutput(),
  }
}

function buildConfigOutput(): string {
  // In a real implementation, this would read from settings.json
  const lines: string[] = []
  lines.push('# Claude Code Configuration')
  lines.push('')
  lines.push('## Available Settings')
  lines.push('')
  lines.push('- **permissionMode** - Permission mode (allow/deny/ask)')
  lines.push('- **model** - Default model to use')
  lines.push('- **maxTokens** - Maximum tokens per response')
  lines.push('- **temperature** - Response temperature')
  lines.push('')
  lines.push('## Usage')
  lines.push('')
  lines.push('Use `/config [key]` to view a specific setting.')
  lines.push('')
  lines.push('Note: Full configuration editing will be available in a future update.')

  return lines.join('\n')
}

function getConfigValue(key: string): string {
  // Placeholder - in real implementation, read from settings
  const config: Record<string, string> = {
    permissionmode: 'ask',
    model: 'claude-opus-4-7',
    maxtokens: '8192',
    temperature: '1',
  }

  const normalizedKey = key.toLowerCase().replace(/-/g, '')
  const value = config[normalizedKey]

  if (value) {
    return `**${key}**: ${value}`
  }

  return `Configuration key "${key}" not found. Use /config to see available settings.`
}
