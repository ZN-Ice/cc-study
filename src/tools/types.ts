/**
 * Tool system type definitions.
 *
 * References: free-code/src/Tool.ts
 */

// ──────────────────────────────────────────────
// JSON Schema (for tool parameters)
// ──────────────────────────────────────────────

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
  items?: JSONSchema;
  enum?: string[];
  default?: unknown;
}

// ──────────────────────────────────────────────
// Tool Result
// ──────────────────────────────────────────────

export interface ToolResult {
  output: string;
  error?: boolean;
}

// ──────────────────────────────────────────────
// Tool Context
// ──────────────────────────────────────────────

export interface ToolContext {
  workingDirectory: string;
  abortSignal: AbortSignal;
}

// ──────────────────────────────────────────────
// Tool Interface
// ──────────────────────────────────────────────

export interface Tool {
  /** Tool name (visible to LLM, e.g. "Read", "Edit", "Bash") */
  readonly name: string;

  /** Tool description (visible to LLM, affects calling decisions) */
  readonly description: string;

  /** Parameter JSON Schema */
  readonly parameters: JSONSchema;

  /** Whether user confirmation is required before execution */
  readonly requiresConfirmation?: boolean;

  /** Execute the tool */
  execute(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult>;
}

// ──────────────────────────────────────────────
// Tool Definition (for API)
// ──────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}
