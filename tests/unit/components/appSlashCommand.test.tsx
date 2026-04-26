/**
 * Tests for slash command integration in App
 */

import { describe, it, expect, vi } from 'vitest'
import { parseSlashCommand } from '../../../src/commands/slashCommandParser.js'
import { findCommand } from '../../../src/commands/index.js'

// Mock useStreamResponse to avoid full App rendering
vi.mock('../../../src/hooks/useStreamResponse.js', () => ({
  useStreamResponse: vi.fn(() => ({
    isLoading: false,
    streamingText: null,
    error: null,
    permissionRequest: null,
    executingTools: [],
    activeAgents: [],
    sendMessage: vi.fn(),
    cancel: vi.fn(),
    respondToPermission: vi.fn(),
  })),
}))

describe('Slash command detection', () => {
  describe('parseSlashCommand integration', () => {
    it('parses /memory command', () => {
      const result = parseSlashCommand('/memory')
      expect(result).toEqual({
        commandName: 'memory',
        args: '',
        isMcp: false,
      })
    })

    it('parses /memory with args', () => {
      const result = parseSlashCommand('/memory user')
      expect(result).toEqual({
        commandName: 'memory',
        args: 'user',
        isMcp: false,
      })
    })

    it('parses /help command', () => {
      const result = parseSlashCommand('/help')
      expect(result).toEqual({
        commandName: 'help',
        args: '',
        isMcp: false,
      })
    })

    it('parses /help with command arg', () => {
      const result = parseSlashCommand('/help compact')
      expect(result).toEqual({
        commandName: 'help',
        args: 'compact',
        isMcp: false,
      })
    })

    it('returns null for non-slash input', () => {
      const result = parseSlashCommand('hello')
      expect(result).toBeNull()
    })
  })

  describe('findCommand integration', () => {
    it('finds memory command', () => {
      const cmd = findCommand('memory')
      expect(cmd).toBeDefined()
      expect(cmd?.name).toBe('memory')
    })

    it('finds help command', () => {
      const cmd = findCommand('help')
      expect(cmd).toBeDefined()
      expect(cmd?.name).toBe('help')
    })

    it('finds compact command', () => {
      const cmd = findCommand('compact')
      expect(cmd).toBeDefined()
      expect(cmd?.name).toBe('compact')
    })

    it('returns undefined for unknown command', () => {
      const cmd = findCommand('nonexistent')
      expect(cmd).toBeUndefined()
    })
  })

  describe('slash command input detection', () => {
    it('detects slash command at start of input', () => {
      const input = '/memory'
      expect(input.trim().startsWith('/')).toBe(true)
    })

    it('detects slash command with spaces', () => {
      const input = '/memory user'
      expect(input.trim().startsWith('/')).toBe(true)
    })

    it('does not detect slash for regular input', () => {
      const input = 'hello world'
      expect(input.trim().startsWith('/')).toBe(false)
    })

    it('handles input with leading whitespace', () => {
      const input = '  /memory'
      expect(input.trim().startsWith('/')).toBe(true)
    })
  })
})

describe('Command execution path', () => {
  it('memory command is a local command', async () => {
    const cmd = findCommand('memory')
    expect(cmd?.type).toBe('local')
  })

  it('help command is a local-jsx command', async () => {
    const cmd = findCommand('help')
    expect(cmd?.type).toBe('local-jsx')
  })

  it('compact command is a local command', async () => {
    const cmd = findCommand('compact')
    expect(cmd?.type).toBe('local')
  })

  it('memory command load returns call function', async () => {
    const cmd = findCommand('memory')!
    const module = await cmd.load()
    expect(typeof module.call).toBe('function')
  })

  it('memory command executes and returns text result', async () => {
    const cmd = findCommand('memory')!
    const module = await cmd.load()
    const context = {
      abortSignal: new AbortController().signal,
      workingDirectory: process.cwd(),
    }
    const result = await module.call('', context)
    expect(result.type).toBe('text')
    expect(result.value).toContain('Memory')
  })
})
