/**
 * Tests for built-in commands
 */

import { describe, it, expect } from 'vitest'
import { helpCommand } from '../../../src/commands/builtins/help.js'
import { compactCommand } from '../../../src/commands/builtins/compact.js'
import { configCommand } from '../../../src/commands/builtins/config.js'
import { resumeCommand } from '../../../src/commands/builtins/resume.js'
import { memoryCommand } from '../../../src/commands/builtins/memory.js'

describe('helpCommand', () => {
  it('has correct name and description', () => {
    expect(helpCommand.name).toBe('help')
    expect(helpCommand.description).toBe('Show available commands and their descriptions')
  })

  it('is a local-jsx command', () => {
    expect(helpCommand.type).toBe('local-jsx')
  })

  it('is user invocable', () => {
    expect(helpCommand.userInvocable).toBe(true)
  })

  it('load returns a module with call function', async () => {
    const module = await helpCommand.load()
    expect(typeof module.call).toBe('function')
  })

  it('call shows help text without args', async () => {
    const module = await helpCommand.load()
    let capturedResult: string | undefined
    const onDone = (result?: string) => {
      capturedResult = result
    }

    await module.call(onDone, {}, '')
    expect(capturedResult).toContain('Available Commands')
    expect(capturedResult).toContain('/help')
    expect(capturedResult).toContain('/compact')
  })

  it('call shows specific command help with args', async () => {
    const module = await helpCommand.load()
    let capturedResult: string | undefined
    const onDone = (result?: string) => {
      capturedResult = result
    }

    await module.call(onDone, {}, 'compact')
    expect(capturedResult).toContain('/compact')
    expect(capturedResult).toContain('Compact the conversation')
  })

  it('call handles unknown command gracefully', async () => {
    const module = await helpCommand.load()
    let capturedResult: string | undefined
    const onDone = (result?: string) => {
      capturedResult = result
    }

    await module.call(onDone, {}, 'nonexistent')
    expect(capturedResult).toContain('not found')
  })
})

describe('compactCommand', () => {
  it('has correct name', () => {
    expect(compactCommand.name).toBe('compact')
  })

  it('is a local command', () => {
    expect(compactCommand.type).toBe('local')
  })

  it('supports non-interactive mode', () => {
    expect(compactCommand.supportsNonInteractive).toBe(true)
  })

  it('load returns a module with call function', async () => {
    const module = await compactCommand.load()
    expect(typeof module.call).toBe('function')
  })

  it('call returns text result', async () => {
    const module = await compactCommand.load()
    const result = await module.call('', {})
    expect(result.type).toBe('text')
  })
})

describe('configCommand', () => {
  it('has correct name', () => {
    expect(configCommand.name).toBe('config')
  })

  it('is a local command', () => {
    expect(configCommand.type).toBe('local')
  })

  it('load returns a module with call function', async () => {
    const module = await configCommand.load()
    expect(typeof module.call).toBe('function')
  })

  it('call shows all config when no args', async () => {
    const module = await configCommand.load()
    const result = await module.call('', {})
    expect(result.type).toBe('text')
    expect(result.value).toContain('Configuration')
  })

  it('call shows specific config when key provided', async () => {
    const module = await configCommand.load()
    const result = await module.call('permissionmode', {})
    expect(result.type).toBe('text')
    expect(result.value).toContain('permissionmode')
  })

  it('call handles unknown config key', async () => {
    const module = await configCommand.load()
    const result = await module.call('nonexistent', {})
    expect(result.type).toBe('text')
    expect(result.value).toContain('not found')
  })
})

describe('resumeCommand', () => {
  it('has correct name', () => {
    expect(resumeCommand.name).toBe('resume')
  })

  it('is a local command', () => {
    expect(resumeCommand.type).toBe('local')
  })

  it('load returns a module with call function', async () => {
    const module = await resumeCommand.load()
    expect(typeof module.call).toBe('function')
  })

  it('call shows usage without session id', async () => {
    const module = await resumeCommand.load()
    const result = await module.call('', {})
    expect(result.type).toBe('text')
    expect(result.value).toContain('/resume')
  })

  it('call shows error for non-uuid input', async () => {
    const module = await resumeCommand.load()
    const result = await module.call('not-a-uuid', {})
    expect(result.type).toBe('text')
    expect(result.value).toContain('No session found')
  })
})

describe('memoryCommand', () => {
  it('has correct name', () => {
    expect(memoryCommand.name).toBe('memory')
  })

  it('is a local command', () => {
    expect(memoryCommand.type).toBe('local')
  })

  it('load returns a module with call function', async () => {
    const module = await memoryCommand.load()
    expect(typeof module.call).toBe('function')
  })

  it('call shows overview without args', async () => {
    const module = await memoryCommand.load()
    const result = await module.call('', {})
    expect(result.type).toBe('text')
    expect(result.value).toContain('Memory')
    expect(result.value).toContain('user')
    expect(result.value).toContain('feedback')
    expect(result.value).toContain('project')
    expect(result.value).toContain('reference')
  })

  it('call shows overview for unknown memory type', async () => {
    const module = await memoryCommand.load()
    const result = await module.call('unknown', {})
    expect(result.type).toBe('text')
    // Unknown type is treated as no args, shows overview
    expect(result.value).toContain('Memory')
    expect(result.value).toContain('## Usage')
  })

  it('call shows valid memory types', async () => {
    const module = await memoryCommand.load()
    const types = ['user', 'feedback', 'project', 'reference']
    for (const type of types) {
      const result = await module.call(type, {})
      expect(result.type).toBe('text')
      expect(result.value).toContain(type)
    }
  })
})
