/**
 * Tool system type definitions.
 *
 * References: free-code/src/Tool.ts
 *
 * Uses Zod for parameter schema definition and runtime validation.
 * Tool lifecycle: validateInput → execute (3-phase with Zod parse as first gate).
 */

import { z } from "zod";
import type { PermissionDecision, ToolPermissionContext } from "../permissions/types.js";

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
  /** Tool-specific metadata for rich UI rendering */
  metadata?: Record<string, unknown>;
}

// ──────────────────────────────────────────────
// Tool Context
// ──────────────────────────────────────────────

export interface ToolContext {
  workingDirectory: string;
  abortSignal: AbortSignal;
  /** API config for nested agent loops (used by AgentTool) */
  apiConfig?: import("../services/api.js").APIConfig;
  /** Parent tool registry for sub-agent tool filtering (used by AgentTool) */
  toolRegistry?: import("./registry.js").ToolRegistry;
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

  /**
   * Permission check (optional, defaults to passthrough).
   * Runs AFTER validateInput, BEFORE execute.
   * Return { behavior: 'deny' } to block, { behavior: 'ask' } for user prompt,
   * or undefined to let the decision chain continue (passthrough).
   * Do NOT return { behavior: 'allow' } for normal cases — that short-circuits
   * the default "ask" behavior. Only tools with inherent safety should return allow.
   */
  checkPermissions?(
    input: z.infer<T>,
    context: ToolContext,
    permContext: ToolPermissionContext,
  ): Promise<PermissionDecision | undefined>;

  /**
   * Classify whether this tool invocation is a search or read operation.
   * Used by plan mode to auto-approve read-only operations.
   */
  isSearchOrReadCommand?(input: z.infer<T>): {
    isSearch: boolean;
    isRead: boolean;
  };

  /**
   * Whether this tool invocation is read-only (never modifies files/state).
   * Used to determine if the tool is safe for parallel execution.
   */
  isReadOnly?(input: z.infer<T>): boolean;

  /**
   * Whether this tool invocation can safely run concurrently with other
   * invocations of the same tool. Read-only tools are typically concurrency-safe.
   */
  isConcurrencySafe?(input: z.infer<T>): boolean;

  /**
   * Extract the primary file path from the tool input.
   * Used for conflict detection during parallel execution.
   * Returns undefined if the tool doesn't operate on a specific file.
   */
  getPath?(input: z.infer<T>): string | undefined;

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
