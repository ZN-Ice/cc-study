/**
 * Built-in /memory command
 * Reference: free-code/src/commands/memory/memory.tsx
 *
 * Opens the memory file editor for managing persistent memory.
 *
 * Memory files are stored in:
 * ~/.claude/projects/{project-id}/memory/
 *
 * Memory types:
 * - user: User preferences and habits
 * - feedback: User corrections and preferences
 * - project: Project-specific information
 * - reference: External system references
 */

import type { Command, CommandContext, LocalCommandResult } from '../types.js'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import { homedir } from 'os'

export const memoryCommand: Command = {
  type: 'local',
  name: 'memory',
  description: 'Manage persistent memory files',
  argumentHint: '[type]',
  whenToUse: 'When you want to view or edit your memory files.',
  isEnabled: () => true,
  isHidden: false,
  userInvocable: true,
  supportsNonInteractive: true,
  load: async () => {
    return { call: memoryCall }
  },
}

type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

async function memoryCall(
  args: string,
  _context: CommandContext,
): Promise<LocalCommandResult> {
  const normalizedArgs = args.trim().toLowerCase()

  // Get memory base path
  const memoryBasePath = getMemoryBasePath()

  // If a specific memory type is requested
  if (normalizedArgs) {
    const memoryType = getMemoryType(normalizedArgs)
    if (memoryType) {
      const memoryPath = getMemoryFilePath(memoryBasePath, memoryType)

      // Try to read existing content
      try {
        await fs.access(memoryPath)
        const content = await fs.readFile(memoryPath, 'utf-8')
        return {
          type: 'text',
          value: `# Memory: ${memoryType}\n\n${content}`,
        }
      } catch {
        // File doesn't exist yet
        return {
          type: 'text',
          value: `# Memory: ${memoryType}\n\n(No content yet. This file will be created when you write to it.)`,
        }
      }
    }

    return {
      type: 'text',
      value: `Unknown memory type "${normalizedArgs}". Valid types: user, feedback, project, reference`,
    }
  }

  // Show memory overview
  return {
    type: 'text',
    value: buildMemoryOverview(memoryBasePath),
  }
}

function getMemoryBasePath(): string {
  // In a real implementation, this would use the project ID
  const projectId = 'default'
  return path.join(homedir(), '.claude', 'projects', projectId, 'memory')
}

function getMemoryType(input: string): MemoryType | null {
  const normalized = input.toLowerCase()
  if (['user', 'feedback', 'project', 'reference'].includes(normalized)) {
    return normalized as MemoryType
  }
  return null
}

function getMemoryFilePath(basePath: string, type: MemoryType): string {
  return path.join(basePath, `${type}.md`)
}

function buildMemoryOverview(memoryBasePath: string): string {
  const types: MemoryType[] = ['user', 'feedback', 'project', 'reference']
  const lines: string[] = []

  lines.push('# Memory')
  lines.push('')
  lines.push('Persistent memory files for storing information across sessions.')
  lines.push('')
  lines.push('## Memory Types')
  lines.push('')

  for (const type of types) {
    const filePath = getMemoryFilePath(memoryBasePath, type)
    let status = '*(not created)*'
    try {
      // Synchronous check - not ideal but works for overview
      fsSync.accessSync(filePath)
      status = '*(exists)*'
    } catch {
      // File doesn't exist
    }
    lines.push(`- **${type}** ${status}`)
  }

  lines.push('')
  lines.push('## Usage')
  lines.push('')
  lines.push('- `/memory user` - View user preferences memory')
  lines.push('- `/memory feedback` - View feedback memory')
  lines.push('- `/memory project` - View project memory')
  lines.push('- `/memory reference` - View reference memory')
  lines.push('')
  lines.push('## Note')
  lines.push('')
  lines.push('Full memory file editing via external editor will be available in a future update.')

  return lines.join('\n')
}
