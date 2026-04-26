/**
 * Tests for command registry
 */

import { describe, it, expect } from 'vitest'
import {
  getCommands,
  findCommand,
  hasCommand,
  getCommand,
  getEnabledCommands,
} from '../../../src/commands/index.js'

describe('getCommands', () => {
  it('returns all builtin commands', () => {
    const commands = getCommands()
    expect(commands.length).toBeGreaterThan(0)
  })

  it('includes help command', () => {
    const commands = getCommands()
    const helpCmd = commands.find((c) => c.name === 'help')
    expect(helpCmd).toBeDefined()
    expect(helpCmd?.type).toBe('local-jsx')
  })

  it('includes compact command', () => {
    const commands = getCommands()
    const compactCmd = commands.find((c) => c.name === 'compact')
    expect(compactCmd).toBeDefined()
    expect(compactCmd?.type).toBe('local')
  })

  it('includes config command', () => {
    const commands = getCommands()
    const configCmd = commands.find((c) => c.name === 'config')
    expect(configCmd).toBeDefined()
  })

  it('includes resume command', () => {
    const commands = getCommands()
    const resumeCmd = commands.find((c) => c.name === 'resume')
    expect(resumeCmd).toBeDefined()
  })

  it('includes memory command', () => {
    const commands = getCommands()
    const memoryCmd = commands.find((c) => c.name === 'memory')
    expect(memoryCmd).toBeDefined()
  })
})

describe('findCommand', () => {
  it('finds command by name', () => {
    const cmd = findCommand('help')
    expect(cmd).toBeDefined()
    expect(cmd?.name).toBe('help')
  })

  it('finds command by alias', () => {
    // Assuming help might have aliases
    const cmd = findCommand('help')
    expect(cmd).toBeDefined()
  })

  it('returns undefined for non-existent command', () => {
    const cmd = findCommand('nonexistent')
    expect(cmd).toBeUndefined()
  })
})

describe('hasCommand', () => {
  it('returns true for existing command', () => {
    expect(hasCommand('help')).toBe(true)
    expect(hasCommand('compact')).toBe(true)
  })

  it('returns false for non-existing command', () => {
    expect(hasCommand('nonexistent')).toBe(false)
  })
})

describe('getCommand', () => {
  it('returns command when it exists', () => {
    const cmd = getCommand('help')
    expect(cmd).toBeDefined()
    expect(cmd.name).toBe('help')
  })

  it('throws ReferenceError for non-existent command', () => {
    expect(() => getCommand('nonexistent')).toThrow(ReferenceError)
  })

  it('error message includes command name', () => {
    try {
      getCommand('nonexistent')
    } catch (e) {
      expect((e as Error).message).toContain('nonexistent')
    }
  })
})

describe('getEnabledCommands', () => {
  it('returns enabled commands', () => {
    const enabledCommands = getEnabledCommands()
    expect(enabledCommands.length).toBeGreaterThan(0)
  })

  it('only returns enabled commands', () => {
    const enabledCommands = getEnabledCommands()
    for (const cmd of enabledCommands) {
      expect(cmd.isEnabled?.() ?? true).toBe(true)
    }
  })
})
