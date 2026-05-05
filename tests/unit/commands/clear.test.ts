/**
 * Tests for /new (alias /clear, /reset) command.
 */

import { describe, it, expect, vi } from 'vitest'
import { executeCommand } from '../../../src/commands/executor.js'
import type { CommandContext } from '../../../src/commands/types.js'
import type { Message } from '../../../src/messages.js'

function createContextWithMessages(
  messages: Message[] = [],
): CommandContext {
  const wrapper: { msgs: Message[] } = { msgs: messages }

  return {
    abortSignal: new AbortController().signal,
    workingDirectory: process.cwd(),
    setMessages: (updater) => {
      wrapper.msgs = updater(wrapper.msgs)
      return wrapper.msgs
    },
    resetSession: undefined,
  }
}

describe('/new command', () => {
  it('clears all messages when setMessages is available', async () => {
    const messages = [
      {
        type: 'user' as const,
        id: '1',
        content: [{ type: 'text' as const, text: 'Hello' }],
        timestamp: Date.now(),
      },
    ]
    const context = createContextWithMessages(messages)

    const result = await executeCommand('/new', context)
    expect(result).not.toBeNull()
    expect(result!.text).toContain('Started a new conversation')
    expect(result!.isSkill).toBe(false)
  })

  it('returns error when setMessages is unavailable', async () => {
    const context: CommandContext = {
      abortSignal: new AbortController().signal,
      workingDirectory: process.cwd(),
    }

    const result = await executeCommand('/new', context)
    expect(result).not.toBeNull()
    expect(result!.text).toContain('unavailable')
  })

  it('invokes resetSession callback when provided', async () => {
    const resetFn = vi.fn()
    const context: CommandContext = {
      abortSignal: new AbortController().signal,
      workingDirectory: process.cwd(),
      setMessages: () => [],
      resetSession: resetFn,
    }

    const result = await executeCommand('/new', context)
    expect(result).not.toBeNull()
    expect(resetFn).toHaveBeenCalledOnce()
  })

  it('works via /clear alias', async () => {
    const context = createContextWithMessages([])

    const result = await executeCommand('/clear', context)
    expect(result).not.toBeNull()
    expect(result!.text).toContain('Started a new conversation')
  })

  it('works via /reset alias', async () => {
    const context = createContextWithMessages([])

    const result = await executeCommand('/reset', context)
    expect(result).not.toBeNull()
    expect(result!.text).toContain('Started a new conversation')
  })

  it('handles extra arguments gracefully', async () => {
    const context = createContextWithMessages([])

    const result = await executeCommand('/new --force', context)
    expect(result).not.toBeNull()
    expect(result!.text).toContain('Started a new conversation')
  })

  it('is a builtin command (not a skill)', async () => {
    const context = createContextWithMessages([])

    const result = await executeCommand('/new', context)
    expect(result).not.toBeNull()
    expect(result!.isSkill).toBe(false)
  })
})
