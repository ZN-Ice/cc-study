/**
 * Tests for PromptInput autocomplete functionality
 * Tests the integration of CommandSelector with PromptInput
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render } from 'ink-testing-library'
import React from 'react'
import { PromptInput } from '../../../src/components/PromptInput.js'
import * as commandsModule from '../../../src/commands/index.js'

// Mock the commands module
vi.mock('../../../src/commands/index.js', async () => {
  const actual = await vi.importActual('../../../src/commands/index.js')
  return {
    ...actual,
    getCommands: vi.fn(),
  }
})

describe('PromptInput Autocomplete', () => {
  const mockCommands = [
    { name: 'help', description: 'Show available commands', isHidden: false, userInvocable: true },
    { name: 'compact', description: 'Compact conversation', isHidden: false, userInvocable: true },
    { name: 'config', description: 'Show configuration', isHidden: false, userInvocable: true },
    { name: 'resume', description: 'Resume session', isHidden: false, userInvocable: true },
  ]

  beforeEach(() => {
    vi.mocked(commandsModule.getCommands).mockReturnValue(mockCommands as unknown as ReturnType<typeof commandsModule.getCommands>)
  })

  test('shows command selector when typing /', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()

    const { lastFrame } = render(
      React.createElement(PromptInput, {
        value: '/',
        onChange,
        onSubmit,
        isLoading: false,
      })
    )

    const output = lastFrame()
    expect(output).toContain('Available commands:')
    expect(output).toContain('/help')
    expect(output).toContain('/compact')
  })

  test('hides command selector when value is not a slash command', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()

    const { lastFrame } = render(
      React.createElement(PromptInput, {
        value: 'hello',
        onChange,
        onSubmit,
        isLoading: false,
      })
    )

    const output = lastFrame()
    expect(output).not.toContain('Available commands:')
  })

  test('filters commands based on input after /', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()

    const { lastFrame } = render(
      React.createElement(PromptInput, {
        value: '/hel',
        onChange,
        onSubmit,
        isLoading: false,
      })
    )

    const output = lastFrame()
    expect(output).toContain('/help')
    expect(output).not.toContain('/compact')
  })

  test('shows placeholder when value is empty', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()

    const { lastFrame } = render(
      React.createElement(PromptInput, {
        value: '',
        onChange,
        onSubmit,
        isLoading: false,
        placeholder: 'Type a message... (Esc to quit)',
      })
    )

    const output = lastFrame()
    expect(output).toContain('Type a message... (Esc to quit)')
  })

  test('shows loading state when isLoading is true', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()

    const { lastFrame } = render(
      React.createElement(PromptInput, {
        value: '',
        onChange,
        onSubmit,
        isLoading: true,
      })
    )

    const output = lastFrame()
    expect(output).toContain('Waiting for response...')
  })

  test('renders prompt indicator', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()

    const { lastFrame } = render(
      React.createElement(PromptInput, {
        value: 'test',
        onChange,
        onSubmit,
        isLoading: false,
      })
    )

    const output = lastFrame()
    expect(output).toContain('>')
  })

  test('hides command selector when command is completed with space', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()

    const { lastFrame } = render(
      React.createElement(PromptInput, {
        value: '/help ',
        onChange,
        onSubmit,
        isLoading: false,
      })
    )

    const output = lastFrame()
    // Command selector should be hidden when command has a space
    expect(output).not.toContain('Available commands:')
    // Should show the command text (cursor may replace trailing space)
    expect(output).toContain('/help')
  })

  test('hides command selector when typing regular text after /', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()

    const { lastFrame } = render(
      React.createElement(PromptInput, {
        value: '/help me',
        onChange,
        onSubmit,
        isLoading: false,
      })
    )

    const output = lastFrame()
    // Command selector should be hidden when there's a space
    expect(output).not.toContain('Available commands:')
  })

  test('shows command selector only for commands without spaces', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()

    // Test with just /
    const { lastFrame: frame1 } = render(
      React.createElement(PromptInput, {
        value: '/',
        onChange,
        onSubmit,
        isLoading: false,
      })
    )
    expect(frame1()).toContain('Available commands:')

    // Test with partial command (no space)
    const { lastFrame: frame2 } = render(
      React.createElement(PromptInput, {
        value: '/hel',
        onChange,
        onSubmit,
        isLoading: false,
      })
    )
    expect(frame2()).toContain('Available commands:')

    // Test with completed command (has space) - should NOT show selector
    const { lastFrame: frame3 } = render(
      React.createElement(PromptInput, {
        value: '/help ',
        onChange,
        onSubmit,
        isLoading: false,
      })
    )
    expect(frame3()).not.toContain('Available commands:')
  })
})
