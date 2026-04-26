/**
 * Tests for slash command parser
 */

import { describe, it, expect } from 'vitest'
import { parseSlashCommand, isSlashCommand } from '../../../src/commands/slashCommandParser.js'

describe('parseSlashCommand', () => {
  it('parses simple command without args', () => {
    const result = parseSlashCommand('/help')
    expect(result).toEqual({
      commandName: 'help',
      args: '',
      isMcp: false,
    })
  })

  it('parses command with args', () => {
    const result = parseSlashCommand('/search foo bar')
    expect(result).toEqual({
      commandName: 'search',
      args: 'foo bar',
      isMcp: false,
    })
  })

  it('parses MCP command with (MCP) suffix', () => {
    const result = parseSlashCommand('/mcp:tool (MCP) arg1 arg2')
    expect(result).toEqual({
      commandName: 'mcp:tool (MCP)',
      args: 'arg1 arg2',
      isMcp: true,
    })
  })

  it('returns null for input without leading slash', () => {
    const result = parseSlashCommand('help')
    expect(result).toBeNull()
  })

  it('returns null for empty input', () => {
    const result = parseSlashCommand('')
    expect(result).toBeNull()
  })

  it('returns null for only slash', () => {
    const result = parseSlashCommand('/')
    expect(result).toBeNull()
  })

  it('handles leading whitespace', () => {
    const result = parseSlashCommand('  /help')
    expect(result).toEqual({
      commandName: 'help',
      args: '',
      isMcp: false,
    })
  })

  it('handles trailing whitespace', () => {
    const result = parseSlashCommand('/help  ')
    expect(result).toEqual({
      commandName: 'help',
      args: '',
      isMcp: false,
    })
  })
})

describe('isSlashCommand', () => {
  it('returns true for slash commands', () => {
    expect(isSlashCommand('/help')).toBe(true)
    expect(isSlashCommand('/search foo')).toBe(true)
  })

  it('returns false for regular text', () => {
    expect(isSlashCommand('hello')).toBe(false)
    expect(isSlashCommand('  hello')).toBe(false)
  })
})
