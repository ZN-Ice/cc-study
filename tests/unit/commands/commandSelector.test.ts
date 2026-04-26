/**
 * Tests for CommandSelector component
 * Tests the slash command autocomplete display
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render } from 'ink-testing-library'
import React from 'react'
import { CommandSelector } from '../../../src/components/CommandSelector.js'
import { getCommands, getCommandName } from '../../../src/commands/index.js'

// Mock the commands module
vi.mock('../../../src/commands/index.js', () => ({
  getCommands: vi.fn(),
  getCommandName: vi.fn((cmd: { name: string }) => cmd.name),
}))

describe('CommandSelector', () => {
  const mockCommands = [
    { name: 'help', description: 'Show available commands', isHidden: false, userInvocable: true },
    { name: 'compact', description: 'Compact conversation', isHidden: false, userInvocable: true },
    { name: 'config', description: 'Show configuration', isHidden: false, userInvocable: true },
    { name: 'resume', description: 'Resume session', isHidden: false, userInvocable: true },
    { name: 'memory', description: 'Manage memory', isHidden: false, userInvocable: true },
    { name: 'hidden', description: 'Hidden command', isHidden: true, userInvocable: true },
  ]

  beforeEach(() => {
    vi.mocked(getCommands).mockReturnValue(mockCommands as unknown as ReturnType<typeof getCommands>)
    vi.mocked(getCommandName).mockImplementation((cmd: { name: string }) => cmd.name)
  })

  test('renders all visible commands when filter is empty', () => {
    const { lastFrame } = render(
      React.createElement(CommandSelector, { filter: '', selectedIndex: 0 })
    )

    const output = lastFrame()
    expect(output).toContain('Available commands:')
    expect(output).toContain('/help')
    expect(output).toContain('/compact')
    expect(output).toContain('/config')
    expect(output).toContain('/resume')
    expect(output).toContain('/memory')
    // Hidden command should not appear
    expect(output).not.toContain('/hidden')
  })

  test('filters commands based on input', () => {
    const { lastFrame } = render(
      React.createElement(CommandSelector, { filter: 'hel', selectedIndex: 0 })
    )

    const output = lastFrame()
    expect(output).toContain('/help')
    expect(output).not.toContain('/compact')
    expect(output).not.toContain('/config')
  })

  test('filters by description', () => {
    const { lastFrame } = render(
      React.createElement(CommandSelector, { filter: 'session', selectedIndex: 0 })
    )

    const output = lastFrame()
    expect(output).toContain('/resume')
    expect(output).not.toContain('/help')
  })

  test('shows message when no commands match', () => {
    const { lastFrame } = render(
      React.createElement(CommandSelector, { filter: 'xyz', selectedIndex: 0 })
    )

    const output = lastFrame()
    expect(output).toContain('No matching commands')
  })

  test('shows navigation instructions', () => {
    const { lastFrame } = render(
      React.createElement(CommandSelector, { filter: '', selectedIndex: 0 })
    )

    const output = lastFrame()
    expect(output).toContain('↑↓ navigate')
    expect(output).toContain('Enter select')
    expect(output).toContain('Esc cancel')
  })

  test('highlights first command by default', () => {
    const { lastFrame } = render(
      React.createElement(CommandSelector, { filter: '', selectedIndex: 0 })
    )

    const output = lastFrame()
    // First command should have > indicator
    expect(output).toContain('> /help')
  })

  test('shows arrow indicator for commands with sub-commands', () => {
    const commandsWithSub = [
      { name: 'help', description: 'Show help', isHidden: false, userInvocable: true },
      { name: 'memory', description: 'Manage memory', isHidden: false, userInvocable: true, subCommands: [
        { name: 'user', description: 'User memory' },
        { name: 'feedback', description: 'Feedback memory' },
      ]},
    ]

    vi.mocked(getCommands).mockReturnValue(commandsWithSub as unknown as ReturnType<typeof getCommands>)

    const { lastFrame } = render(
      React.createElement(CommandSelector, { filter: '', selectedIndex: 0 })
    )

    const output = lastFrame()
    expect(output).toContain('/memory')
    expect(output).toContain('→')
  })

  test('filters sub-commands when command is selected', () => {
    const commandsWithSub = [
      { name: 'memory', description: 'Manage memory', isHidden: false, userInvocable: true, subCommands: [
        { name: 'user', description: 'User memory' },
        { name: 'feedback', description: 'Feedback memory' },
        { name: 'project', description: 'Project memory' },
      ]},
    ]

    vi.mocked(getCommands).mockReturnValue(commandsWithSub as unknown as ReturnType<typeof getCommands>)

    // Filter with command + space = sub-command mode
    const { lastFrame } = render(
      React.createElement(CommandSelector, { filter: 'memory ', selectedIndex: 0 })
    )

    const output = lastFrame()
    expect(output).toContain('/memory parameters:')
    expect(output).toContain('user')
    expect(output).toContain('feedback')
    expect(output).toContain('project')
  })

  test('filters sub-commands by name when command is specified', () => {
    const commandsWithSub = [
      { name: 'memory', description: 'Manage memory', isHidden: false, userInvocable: true, subCommands: [
        { name: 'user', description: 'User memory' },
        { name: 'feedback', description: 'Feedback memory' },
        { name: 'project', description: 'Project memory' },
      ]},
    ]

    vi.mocked(getCommands).mockReturnValue(commandsWithSub as unknown as ReturnType<typeof getCommands>)

    // Filter with command + space + sub-filter ("proj" should only match "project")
    const { lastFrame } = render(
      React.createElement(CommandSelector, { filter: 'memory proj', selectedIndex: 0 })
    )

    const output = lastFrame()
    expect(output).toContain('/memory parameters:')
    expect(output).toContain('project')
    // Other sub-commands should be filtered out
    expect(output).not.toContain('user')
    expect(output).not.toContain('feedback')
  })

  test('highlights selected index correctly', () => {
    const { lastFrame } = render(
      React.createElement(CommandSelector, { filter: '', selectedIndex: 2 })
    )

    const output = lastFrame()
    // Third command (config, index 2) should be highlighted
    expect(output).toContain('> /config')
    // First command should not be highlighted
    expect(output).not.toContain('> /help')
  })
})
