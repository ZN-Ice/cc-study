/**
 * Tests for memory system
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  memoryCommand,
  getMemoryBasePath,
  getMemoryFilePath,
  getMemoryType,
  parseMemoryArgs,
  buildMemoryOverview,
} from '../../../src/commands/builtins/memory.js'

describe('memoryCommand', () => {
  describe('basic properties', () => {
    it('has correct name', () => {
      expect(memoryCommand.name).toBe('memory')
    })

    it('is a local command', () => {
      expect(memoryCommand.type).toBe('local')
    })

    it('supports non-interactive mode', () => {
      expect(memoryCommand.supportsNonInteractive).toBe(true)
    })

    it('is user invocable', () => {
      expect(memoryCommand.userInvocable).toBe(true)
    })
  })

  describe('load', () => {
    it('returns a module with call function', async () => {
      const module = await memoryCommand.load()
      expect(typeof module.call).toBe('function')
    })
  })
})

describe('getMemoryBasePath', () => {
  it('returns path in correct location', () => {
    const basePath = getMemoryBasePath('test-project')
    expect(basePath).toContain('.claude')
    expect(basePath).toContain('projects')
    expect(basePath).toContain('test-project')
    expect(basePath).toContain('memory')
  })

  it('uses default project id when not specified', () => {
    const basePath = getMemoryBasePath()
    expect(basePath).toContain('default')
  })
})

describe('getMemoryFilePath', () => {
  it('returns correct path for memory type', () => {
    const basePath = '/test/base'
    const filePath = getMemoryFilePath(basePath, 'user')
    expect(filePath).toBe('/test/base/user.md')
  })

  it('returns correct path for all memory types', () => {
    const basePath = '/test/base'
    const types = ['user', 'feedback', 'project', 'reference'] as const

    for (const type of types) {
      const filePath = getMemoryFilePath(basePath, type)
      expect(filePath).toBe(`/test/base/${type}.md`)
    }
  })
})

describe('getMemoryType', () => {
  it('returns correct type for valid inputs', () => {
    expect(getMemoryType('user')).toBe('user')
    expect(getMemoryType('feedback')).toBe('feedback')
    expect(getMemoryType('project')).toBe('project')
    expect(getMemoryType('reference')).toBe('reference')
  })

  it('returns null for invalid inputs', () => {
    expect(getMemoryType('unknown')).toBeNull()
    expect(getMemoryType('')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(getMemoryType('USER')).toBe('user')
    expect(getMemoryType('Feedback')).toBe('feedback')
    expect(getMemoryType('PROJECT')).toBe('project')
    expect(getMemoryType('REFERENCE')).toBe('reference')
  })
})

describe('parseMemoryArgs', () => {
  it('returns read with no args', () => {
    const result = parseMemoryArgs('')
    expect(result.type).toBeNull()
    expect(result.action).toBe('read')
    expect(result.content).toBe('')
  })

  it('parses memory type for read', () => {
    const result = parseMemoryArgs('user')
    expect(result.type).toBe('user')
    expect(result.action).toBe('read')
    expect(result.content).toBe('')
  })

  it('parses write command', () => {
    const result = parseMemoryArgs('user write some content')
    expect(result.type).toBe('user')
    expect(result.action).toBe('write')
    expect(result.content).toBe('some content')
  })

  it('parses write command with multiple words', () => {
    const result = parseMemoryArgs('feedback write user prefers concise responses')
    expect(result.type).toBe('feedback')
    expect(result.action).toBe('write')
    expect(result.content).toBe('user prefers concise responses')
  })

  it('returns read for unknown type', () => {
    const result = parseMemoryArgs('unknown')
    expect(result.type).toBeNull()
    expect(result.action).toBe('read')
  })

  it('handles whitespace', () => {
    const result = parseMemoryArgs('  project  write  content  ')
    expect(result.type).toBe('project')
    expect(result.action).toBe('write')
    expect(result.content).toBe('content')
  })
})

describe('buildMemoryOverview', () => {
  it('returns markdown formatted overview', () => {
    const overview = buildMemoryOverview('/test/memory')
    expect(overview).toContain('# Memory')
    expect(overview).toContain('user')
    expect(overview).toContain('feedback')
    expect(overview).toContain('project')
    expect(overview).toContain('reference')
    expect(overview).toContain('/memory user')
    expect(overview).toContain('/memory feedback')
  })

  it('shows write command in usage', () => {
    const overview = buildMemoryOverview('/test/memory')
    expect(overview).toContain('write')
  })
})

describe('memoryCommand call', () => {
  // Use a temp directory for testing
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-study-memory-test-'))
  })

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('shows overview without args', async () => {
    const module = await memoryCommand.load()
    const result = await module.call('', {})

    expect(result.type).toBe('text')
    expect(result.value).toContain('Memory')
    expect(result.value).toContain('user')
    expect(result.value).toContain('feedback')
    expect(result.value).toContain('project')
    expect(result.value).toContain('reference')
  })

  it('shows memory content for valid type', async () => {
    const module = await memoryCommand.load()
    const result = await module.call('user', {})

    expect(result.type).toBe('text')
    expect(result.value).toContain('Memory')
    expect(result.value).toContain('user')
    // Should indicate no content yet
    expect(result.value).toContain('No content yet')
  })

  it('shows overview for unknown memory type (treats as no args)', async () => {
    const module = await memoryCommand.load()
    const result = await module.call('unknown', {})

    expect(result.type).toBe('text')
    // Unknown type is treated as no args, so shows overview
    expect(result.value).toContain('Memory')
    expect(result.value).toContain('## Usage')
  })

  it('shows all valid memory types', async () => {
    const module = await memoryCommand.load()
    const types = ['user', 'feedback', 'project', 'reference']

    for (const type of types) {
      const result = await module.call(type, {})
      expect(result.type).toBe('text')
      expect(result.value).toContain(type)
    }
  })

  it('shows write command in examples', async () => {
    const module = await memoryCommand.load()
    const result = await module.call('', {})

    expect(result.value).toContain('/memory <type> write <content>')
  })
})
