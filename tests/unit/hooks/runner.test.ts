/**
 * Tests for Hook system
 */

import { describe, it, expect, vi } from 'vitest'
import type { ToolResult } from '../../../src/tools/types.js'

// Mock types for testing - inline them to avoid circular dependencies
interface PreToolUseHook {
  type: 'PreToolUse'
  name: string
  enabled?: boolean
  beforeToolUse: (toolName: string, input: unknown) => boolean | Promise<boolean>
}

interface PostToolUseHook {
  type: 'PostToolUse'
  name: string
  enabled?: boolean
  afterToolUse: (toolName: string, input: unknown, result: ToolResult) => void | Promise<void>
}

interface StopHook {
  type: 'Stop'
  name: string
  enabled?: boolean
  onStop: () => void | Promise<void>
}

describe('HookRunner', () => {
  describe('runPreToolUseHooks', () => {
    it('returns true when no pre hooks are registered', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')
      const runner = new HookRunner({})

      const result = await runner.runPreToolUseHooks('Read', { file_path: 'test.txt' })
      expect(result).toBe(true)
    })

    it('returns true when all pre hooks return true', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')

      const hook1: PreToolUseHook = {
        type: 'PreToolUse',
        name: 'hook1',
        enabled: true,
        beforeToolUse: vi.fn().mockReturnValue(true),
      }

      const hook2: PreToolUseHook = {
        type: 'PreToolUse',
        name: 'hook2',
        enabled: true,
        beforeToolUse: vi.fn().mockReturnValue(true),
      }

      const runner = new HookRunner({
        preToolUse: [hook1, hook2],
      })

      const result = await runner.runPreToolUseHooks('Read', { file_path: 'test.txt' })

      expect(result).toBe(true)
      expect(hook1.beforeToolUse).toHaveBeenCalledWith('Read', { file_path: 'test.txt' })
      expect(hook2.beforeToolUse).toHaveBeenCalledWith('Read', { file_path: 'test.txt' })
    })

    it('returns false when any pre hook returns false', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')

      const hook1: PreToolUseHook = {
        type: 'PreToolUse',
        name: 'hook1',
        enabled: true,
        beforeToolUse: vi.fn().mockReturnValue(true),
      }

      const hook2: PreToolUseHook = {
        type: 'PreToolUse',
        name: 'hook2',
        enabled: true,
        beforeToolUse: vi.fn().mockReturnValue(false),
      }

      const hook3: PreToolUseHook = {
        type: 'PreToolUse',
        name: 'hook3',
        enabled: true,
        beforeToolUse: vi.fn().mockReturnValue(true),
      }

      const runner = new HookRunner({
        preToolUse: [hook1, hook2, hook3],
      })

      const result = await runner.runPreToolUseHooks('Read', {})

      expect(result).toBe(false)
      // hook3 should not be called since hook2 returned false
      expect(hook3.beforeToolUse).not.toHaveBeenCalled()
    })

    it('skips disabled hooks', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')

      const enabledHook: PreToolUseHook = {
        type: 'PreToolUse',
        name: 'enabled',
        enabled: true,
        beforeToolUse: vi.fn().mockReturnValue(true),
      }

      const disabledHook: PreToolUseHook = {
        type: 'PreToolUse',
        name: 'disabled',
        enabled: false,
        beforeToolUse: vi.fn().mockReturnValue(false),
      }

      const runner = new HookRunner({
        preToolUse: [disabledHook, enabledHook],
      })

      const result = await runner.runPreToolUseHooks('Read', {})

      expect(result).toBe(true)
      expect(disabledHook.beforeToolUse).not.toHaveBeenCalled()
      expect(enabledHook.beforeToolUse).toHaveBeenCalled()
    })

    it('treats undefined enabled as true (default to enabled)', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')

      const hook: PreToolUseHook = {
        type: 'PreToolUse',
        name: 'hook',
        // enabled is undefined
        beforeToolUse: vi.fn().mockReturnValue(true),
      }

      const runner = new HookRunner({
        preToolUse: [hook],
      })

      const result = await runner.runPreToolUseHooks('Read', {})

      expect(result).toBe(true)
      expect(hook.beforeToolUse).toHaveBeenCalled()
    })

    it('handles async hooks', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')

      const asyncHook: PreToolUseHook = {
        type: 'PreToolUse',
        name: 'asyncHook',
        enabled: true,
        beforeToolUse: vi.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
          return true
        }),
      }

      const runner = new HookRunner({
        preToolUse: [asyncHook],
      })

      const result = await runner.runPreToolUseHooks('Read', {})

      expect(result).toBe(true)
      expect(asyncHook.beforeToolUse).toHaveBeenCalled()
    })
  })

  describe('runPostToolUseHooks', () => {
    it('does not throw when no post hooks are registered', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')
      const runner = new HookRunner({})

      const result: ToolResult = { output: 'test output' }

      await expect(
        runner.runPostToolUseHooks('Read', { file_path: 'test.txt' }, result)
      ).resolves.not.toThrow()
    })

    it('calls all post hooks with tool result', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')

      const hook1: PostToolUseHook = {
        type: 'PostToolUse',
        name: 'hook1',
        enabled: true,
        afterToolUse: vi.fn(),
      }

      const hook2: PostToolUseHook = {
        type: 'PostToolUse',
        name: 'hook2',
        enabled: true,
        afterToolUse: vi.fn(),
      }

      const runner = new HookRunner({
        postToolUse: [hook1, hook2],
      })

      const result: ToolResult = { output: 'test output' }

      await runner.runPostToolUseHooks('Read', { file_path: 'test.txt' }, result)

      expect(hook1.afterToolUse).toHaveBeenCalledWith('Read', { file_path: 'test.txt' }, result)
      expect(hook2.afterToolUse).toHaveBeenCalledWith('Read', { file_path: 'test.txt' }, result)
    })

    it('skips disabled post hooks', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')

      const enabledHook: PostToolUseHook = {
        type: 'PostToolUse',
        name: 'enabled',
        enabled: true,
        afterToolUse: vi.fn(),
      }

      const disabledHook: PostToolUseHook = {
        type: 'PostToolUse',
        name: 'disabled',
        enabled: false,
        afterToolUse: vi.fn(),
      }

      const runner = new HookRunner({
        postToolUse: [enabledHook, disabledHook],
      })

      const result: ToolResult = { output: 'test' }

      await runner.runPostToolUseHooks('Read', {}, result)

      expect(enabledHook.afterToolUse).toHaveBeenCalled()
      expect(disabledHook.afterToolUse).not.toHaveBeenCalled()
    })

    it('handles async post hooks', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')

      const asyncHook: PostToolUseHook = {
        type: 'PostToolUse',
        name: 'asyncHook',
        enabled: true,
        afterToolUse: vi.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
        }),
      }

      const runner = new HookRunner({
        postToolUse: [asyncHook],
      })

      const result: ToolResult = { output: 'test' }

      await runner.runPostToolUseHooks('Read', {}, result)

      expect(asyncHook.afterToolUse).toHaveBeenCalled()
    })
  })

  describe('runStopHooks', () => {
    it('does not throw when no stop hooks are registered', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')
      const runner = new HookRunner({})

      await expect(runner.runStopHooks()).resolves.not.toThrow()
    })

    it('calls all stop hooks', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')

      const hook1: StopHook = {
        type: 'Stop',
        name: 'hook1',
        enabled: true,
        onStop: vi.fn(),
      }

      const hook2: StopHook = {
        type: 'Stop',
        name: 'hook2',
        enabled: true,
        onStop: vi.fn(),
      }

      const runner = new HookRunner({
        stop: [hook1, hook2],
      })

      await runner.runStopHooks()

      expect(hook1.onStop).toHaveBeenCalled()
      expect(hook2.onStop).toHaveBeenCalled()
    })

    it('skips disabled stop hooks', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')

      const enabledHook: StopHook = {
        type: 'Stop',
        name: 'enabled',
        enabled: true,
        onStop: vi.fn(),
      }

      const disabledHook: StopHook = {
        type: 'Stop',
        name: 'disabled',
        enabled: false,
        onStop: vi.fn(),
      }

      const runner = new HookRunner({
        stop: [enabledHook, disabledHook],
      })

      await runner.runStopHooks()

      expect(enabledHook.onStop).toHaveBeenCalled()
      expect(disabledHook.onStop).not.toHaveBeenCalled()
    })

    it('handles async stop hooks', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')

      const asyncHook: StopHook = {
        type: 'Stop',
        name: 'asyncHook',
        enabled: true,
        onStop: vi.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 10))
        }),
      }

      const runner = new HookRunner({
        stop: [asyncHook],
      })

      await runner.runStopHooks()

      expect(asyncHook.onStop).toHaveBeenCalled()
    })
  })

  describe('constructor', () => {
    it('accepts empty config', () => {
      return expect(async () => {
        const { HookRunner } = await import('../../../src/hooks/runner.js')
        new HookRunner({})
      }).not.toThrow()
    })

    it('accepts config with all hook types', async () => {
      const { HookRunner } = await import('../../../src/hooks/runner.js')

      const preHook: PreToolUseHook = {
        type: 'PreToolUse',
        name: 'pre',
        beforeToolUse: () => true,
      }

      const postHook: PostToolUseHook = {
        type: 'PostToolUse',
        name: 'post',
        afterToolUse: () => {},
      }

      const stopHook: StopHook = {
        type: 'Stop',
        name: 'stop',
        onStop: () => {},
      }

      const runner = new HookRunner({
        preToolUse: [preHook],
        postToolUse: [postHook],
        stop: [stopHook],
      })

      expect(runner).toBeDefined()
    })
  })
})

describe('HookConfig', () => {
  it('can be created with no hooks', async () => {
    const { HookRunner } = await import('../../../src/hooks/runner.js')
    const runner = new HookRunner({})

    // All methods should work without error
    await runner.runPreToolUseHooks('Read', {})
    await runner.runPostToolUseHooks('Read', {}, { output: '' })
    await runner.runStopHooks()
  })
})
