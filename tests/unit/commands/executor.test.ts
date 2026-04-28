/**
 * Tests for command executor
 * Covers the full execution path: parse → find → load → execute
 */

import { describe, it, expect } from 'vitest'
import { executeCommand } from '../../../src/commands/executor.js'
import type { CommandContext } from '../../../src/commands/types.js'

const defaultContext: CommandContext = {
  abortSignal: new AbortController().signal,
  workingDirectory: process.cwd(),
}

describe('executeCommand', () => {
  // ── local commands ──

  describe('local commands', () => {
    it('executes /config and returns text', async () => {
      const result = await executeCommand('/config', defaultContext)
      expect(result).not.toBeNull()
      expect(result!.text).toContain('Configuration')
      expect(result!.isSkill).toBe(false)
    })

    it('executes /config with key arg', async () => {
      const result = await executeCommand('/config model', defaultContext)
      expect(result).not.toBeNull()
      expect(result!.text).toContain('model')
    })

    it('executes /compact without setMessages', async () => {
      const result = await executeCommand('/compact', defaultContext)
      expect(result).not.toBeNull()
      expect(result!.text).toContain('No conversation to compact')
    })

    it('executes /resume without args', async () => {
      const result = await executeCommand('/resume', defaultContext)
      expect(result).not.toBeNull()
      expect(result!.text).toContain('/resume')
    })

    it('executes /memory and returns overview', async () => {
      const result = await executeCommand('/memory', defaultContext)
      expect(result).not.toBeNull()
      expect(result!.text).toContain('Memory')
    })
  })

  // ── local-jsx commands ──

  describe('local-jsx commands', () => {
    it('executes /help and returns text output', async () => {
      const result = await executeCommand('/help', defaultContext)
      expect(result).not.toBeNull()
      expect(result!.text).toContain('Available Commands')
      expect(result!.isSkill).toBe(false)
    })

    it('/help shows specific command details', async () => {
      const result = await executeCommand('/help compact', defaultContext)
      expect(result).not.toBeNull()
      expect(result!.text).toContain('/compact')
    })

    it('/help handles unknown command args', async () => {
      const result = await executeCommand('/help nonexistent', defaultContext)
      expect(result).not.toBeNull()
      expect(result!.text).toContain('not found')
    })
  })

  // ── error handling ──

  describe('error handling', () => {
    it('returns null for non-slash input', async () => {
      const result = await executeCommand('hello world', defaultContext)
      expect(result).toBeNull()
    })

    it('returns error for unknown command', async () => {
      const result = await executeCommand('/unknown', defaultContext)
      expect(result!.text).toContain('Command not found')
      expect(result!.isSkill).toBe(false)
    })

    it('returns error for bare slash', async () => {
      const result = await executeCommand('/', defaultContext)
      expect(result!.text).toContain('Unknown slash command format')
    })

    it('handles whitespace around input', async () => {
      const result = await executeCommand('  /help  ', defaultContext)
      expect(result).not.toBeNull()
      expect(result!.text).toContain('Available Commands')
    })
  })
})
