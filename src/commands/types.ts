/**
 * Command type definitions for cc-study slash command system
 * Reference: free-code/src/types/command.ts
 *
 * Simplified version focusing on core functionality.
 */

// ============================================================================
// Command Result Types
// ============================================================================

export type LocalCommandResult =
  | { type: 'text'; value: string }
  | { type: 'skip' }

export type CommandResultDisplay = 'skip' | 'system' | 'user'

// ============================================================================
// Command Context (simplified version of ToolUseContext)
// ============================================================================

export interface CommandContext {
  abortSignal: AbortSignal
  workingDirectory: string
  canUseTool?: (toolName: string) => boolean
  setMessages?: (updater: (prev: Message[]) => Message[]) => void
  resume?: (
    sessionId: string,
    log: unknown,
    entrypoint: ResumeEntrypoint,
  ) => Promise<void>
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: unknown[]
}

export type ResumeEntrypoint =
  | 'cli_flag'
  | 'slash_command_picker'
  | 'slash_command_session_id'
  | 'slash_command_title'
  | 'fork'

// ============================================================================
// Command Base Types
// ============================================================================

export type CommandAvailability = 'claude-ai' | 'console'

export interface CommandBase {
  name: string
  description: string
  aliases?: string[]
  argumentHint?: string
  whenToUse?: string
  version?: string
  isEnabled?: () => boolean
  isHidden?: boolean
  availability?: CommandAvailability[]
  disableModelInvocation?: boolean
  userInvocable?: boolean
  loadedFrom?: 'builtin' | 'mcp' | 'plugin' | 'bundled' | 'managed' | 'user'
  kind?: 'workflow'
  immediate?: boolean
  isSensitive?: boolean
  userFacingName?: () => string
}

// ============================================================================
// Prompt Command - Returns content for model
// ============================================================================

export interface PromptCommand extends CommandBase {
  type: 'prompt'
  progressMessage: string
  contentLength: number
  argNames?: string[]
  allowedTools?: string[]
  model?: string
  source: 'builtin' | 'mcp' | 'plugin' | 'bundled' | 'managed' | 'user'
  getPromptForCommand(
    args: string,
    context: CommandContext,
  ): Promise<ContentBlockParam[]>
}

export interface ContentBlockParam {
  type: 'text'
  text: string
}

// ============================================================================
// Local Command - Returns text result locally
// ============================================================================

export type LocalCommandCall = (
  args: string,
  context: CommandContext,
) => Promise<LocalCommandResult>

export type LocalCommandModule = {
  call: LocalCommandCall
}

export interface LocalCommand extends CommandBase {
  type: 'local'
  supportsNonInteractive: boolean
  load: () => Promise<LocalCommandModule>
}

// ============================================================================
// Local JSX Command - Returns React component
// ============================================================================

export type LocalJSXCommandOnDone = (
  result?: string,
  options?: {
    display?: CommandResultDisplay
    shouldQuery?: boolean
    metaMessages?: string[]
    nextInput?: string
    submitNextInput?: boolean
  },
) => void

export type LocalJSXCommandCall = (
  onDone: LocalJSXCommandOnDone,
  context: CommandContext,
  args: string,
) => Promise<React.ReactNode | null>

export type LocalJSXCommandModule = {
  call: LocalJSXCommandCall
}

export interface LocalJSXCommand extends CommandBase {
  type: 'local-jsx'
  load: () => Promise<LocalJSXCommandModule>
}

// ============================================================================
// Complete Command Type
// ============================================================================

export type Command = CommandBase & (PromptCommand | LocalCommand | LocalJSXCommand)

// ============================================================================
// Helper Functions
// ============================================================================

export function getCommandName(cmd: CommandBase): string {
  return cmd.userFacingName?.() ?? cmd.name
}

export function isCommandEnabled(cmd: CommandBase): boolean {
  return cmd.isEnabled?.() ?? true
}
