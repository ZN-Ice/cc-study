/**
 * Tool system type definitions.
 *
 * References: free-code/src/Tool.ts
 *
 * Uses Zod for parameter schema definition and runtime validation.
 * Tool lifecycle: validateInput → execute (3-phase with Zod parse as first gate).
 */

import { z } from "zod";

// ──────────────────────────────────────────────
// Validation Result
// ──────────────────────────────────────────────

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

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

/**
 * Tool interface with Zod-based parameter schema.
 *
 * Lifecycle:
 * 1. Zod parse: inputSchema.safeParse(rawInput) — type & structure validation
 * 2. validateInput: semantic validation (file exists, string match, etc.)
 * 3. execute: actual tool execution with typed, validated params
 *
 * Generic T allows each tool to infer concrete input types via z.infer<T>.
 * Registry uses Tool (defaults to z.ZodType) for heterogeneous storage.
 */
export interface Tool<T extends z.ZodType = z.ZodType> {
  /** Tool name (visible to LLM, e.g. "Read", "Edit", "Bash") */
  readonly name: string;

  /** Tool description (visible to LLM, affects calling decisions) */
  readonly description: string;

  /** Zod schema defining the tool's input parameters */
  readonly inputSchema: T;

  /** Whether user confirmation is required before execution */
  readonly requiresConfirmation?: boolean;

  /**
   * Semantic validation of parsed input.
   * Runs AFTER Zod parse (type safety guaranteed).
   * Use for: file existence, string match, uniqueness checks, etc.
   */
  validateInput(
    input: z.infer<T>,
    context: ToolContext,
  ): Promise<ValidationResult>;

  /** Execute the tool with typed, validated parameters */
  execute(
    input: z.infer<T>,
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
