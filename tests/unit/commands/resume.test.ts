/**
 * Tests for resume command
 */

import { describe, it, expect } from 'vitest'
import { resumeCommand } from '../../../src/commands/builtins/resume.js'

describe('resumeCommand', () => {
  describe('basic properties', () => {
    it('has correct name', () => {
      expect(resumeCommand.name).toBe('resume')
    })

    it('is a local command', () => {
      expect(resumeCommand.type).toBe('local')
    })

    it('supports non-interactive mode', () => {
      expect(resumeCommand.supportsNonInteractive).toBe(true)
    })

    it('is user invocable', () => {
      expect(resumeCommand.userInvocable).toBe(true)
    })

    it('has correct description', () => {
      expect(resumeCommand.description).toBe('Resume a previous conversation session')
    })

    it('has correct argumentHint', () => {
      expect(resumeCommand.argumentHint).toBe('[session-id]')
    })
  })

  describe('load', () => {
    it('returns a module with call function', async () => {
      const module = await resumeCommand.load()
      expect(typeof module.call).toBe('function')
    })
  })

  describe('call', () => {
    it('shows usage without session id', async () => {
      const module = await resumeCommand.load()
      const result = await module.call('', {})

      expect(result.type).toBe('text')
      expect(result.value).toContain('/resume')
      expect(result.value).toContain('Usage')
    })

    it('shows error for invalid uuid format', async () => {
      const module = await resumeCommand.load()
      const result = await module.call('not-a-uuid', {})

      expect(result.type).toBe('text')
      expect(result.value).toContain('No session found matching')
    })

    it('shows error for short input', async () => {
      const module = await resumeCommand.load()
      const result = await module.call('abc', {})

      expect(result.type).toBe('text')
      expect(result.value).toContain('No session found matching')
    })

    it('handles partial uuid format', async () => {
      const module = await resumeCommand.load()
      const result = await module.call('123e4567-e89b-12d3-a456', {})

      expect(result.type).toBe('text')
      expect(result.value).toContain('No session found matching')
    })

    it('shows message for valid uuid without context.resume', async () => {
      const module = await resumeCommand.load()
      const result = await module.call('123e4567-e89b-12d3-a456-426614174000', {})

      expect(result.type).toBe('text')
      expect(result.value).toContain('Session resume functionality is not yet implemented')
    })

    it('shows message for valid uuid with context.resume that throws', async () => {
      const module = await resumeCommand.load()
      const mockResume = vi.fn().mockRejectedValue(new Error('Session not found'))
      const mockContext = { resume: mockResume } as unknown as { resume?: (id: string, opts: Record<string, unknown>, source: string) => Promise<void> }
      const result = await module.call('123e4567-e89b-12d3-a456-426614174000', mockContext)

      expect(result.type).toBe('text')
      expect(result.value).toContain('Failed to resume session')
    })

    it('shows success message when resume succeeds', async () => {
      const module = await resumeCommand.load()
      const mockResume = vi.fn().mockResolvedValue(undefined)
      const mockContext = { resume: mockResume } as unknown as { resume?: (id: string, opts: Record<string, unknown>, source: string) => Promise<void> }
      const result = await module.call('123e4567-e89b-12d3-a456-426614174000', mockContext)

      expect(result.type).toBe('text')
      expect(result.value).toContain('Resuming session')
      expect(mockResume).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174000', {}, 'slash_command_session_id')
    })
  })

  describe('UUID validation', () => {
    it('accepts valid lowercase UUID', async () => {
      const module = await resumeCommand.load()
      const result = await module.call('123e4567-e89b-12d3-a456-426614174000', {})

      // Should not contain "No session found" - it should try to resume
      expect(result.value).not.toContain('No session found matching')
    })

    it('accepts valid uppercase UUID', async () => {
      const module = await resumeCommand.load()
      const result = await module.call('123E4567-E89B-12D3-A456-426614174000', {})

      // Should not contain "No session found" - it should try to resume
      expect(result.value).not.toContain('No session found matching')
    })

    it('accepts UUID with mixed case', async () => {
      const module = await resumeCommand.load()
      const result = await module.call('123e4567-E89B-12d3-A456-426614174000', {})

      // Should not contain "No session found" - it should try to resume
      expect(result.value).not.toContain('No session found matching')
    })
  })
})
