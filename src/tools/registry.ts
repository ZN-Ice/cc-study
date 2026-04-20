/**
 * Tool registry: register, discover, and manage tools.
 *
 * References: free-code/src/tools.ts
 */

import { z } from "zod";
import type { Tool, ToolDefinition, ToolResult, ToolContext } from "./types.js";
import type { PermissionManager } from "../permissions/manager.js";
import type { PermissionDecision } from "../permissions/types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  /** Register a tool */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Get a tool by name */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Get all registered tools */
  getAll(): Tool[] {
    return [...this.tools.values()];
  }

  /** Get all tool names */
  getNames(): string[] {
    return [...this.tools.keys()];
  }

  /** Generate tool definitions for the Anthropic API */
  getToolDefinitions(): ToolDefinition[] {
    return this.getAll().map((tool) => {
      const jsonSchema = z.toJSONSchema(tool.inputSchema) as {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
        [key: string]: unknown;
      };
      return {
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: "object" as const,
          properties: jsonSchema.properties ?? {},
          required: jsonSchema.required ?? [],
        },
      };
    });
  }

  /** Check if a tool exists */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Number of registered tools */
  get size(): number {
    return this.tools.size;
  }
}

/**
 * Format Zod error into a human-readable string.
 */
function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/** Callback invoked when a permission check returns 'ask'. */
export type OnPermissionAsk = (
  decision: PermissionDecision,
) => Promise<{ allowed: boolean; alwaysAllow: boolean }>;

/**
 * Execute a tool by name using the given registry.
 *
 * Three-phase lifecycle:
 * 1. Zod parse: validate input types & structure
 * 2. validateInput: semantic validation (file exists, string match, etc.)
 * 3. execute: actual tool execution
 */
export async function executeTool(
  registry: ToolRegistry,
  name: string,
  rawInput: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const tool = registry.get(name);
  if (!tool) {
    return {
      output: `Unknown tool: ${name}`,
      error: true,
    };
  }

  // Phase 1: Zod parse — type & structure validation
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      output: `Invalid parameters: ${formatZodError(parsed.error)}`,
      error: true,
    };
  }

  // Phase 2: validateInput — semantic validation
  try {
    const validation = await tool.validateInput(
      parsed.data as Parameters<typeof tool.validateInput>[0],
      context,
    );
    if (!validation.ok) {
      return {
        output: validation.error,
        error: true,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: `Validation error: ${message}`,
      error: true,
    };
  }

  // Phase 3: execute — actual tool execution
  try {
    return await tool.execute(
      parsed.data as Parameters<typeof tool.execute>[0],
      context,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: `Tool execution error: ${message}`,
      error: true,
    };
  }
}

/**
 * Execute a tool with permission checking.
 *
 * Like executeTool, but adds a permission check between validation and execution.
 * When the check returns 'ask', calls onPermissionAsk to let the user decide.
 */
export async function executeToolWithPermissions(
  registry: ToolRegistry,
  name: string,
  rawInput: Record<string, unknown>,
  context: ToolContext,
  permissionManager: PermissionManager,
  onPermissionAsk?: OnPermissionAsk,
): Promise<ToolResult> {
  const tool = registry.get(name);
  if (!tool) {
    return { output: `Unknown tool: ${name}`, error: true };
  }

  // Phase 1: Zod parse
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      output: `Invalid parameters: ${formatZodError(parsed.error)}`,
      error: true,
    };
  }

  // Phase 2: validateInput
  try {
    const validation = await tool.validateInput(
      parsed.data as Parameters<typeof tool.validateInput>[0],
      context,
    );
    if (!validation.ok) {
      return { output: validation.error, error: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Validation error: ${message}`, error: true };
  }

  // Phase 2.5: Permission check
  const decision = await permissionManager.check(tool, rawInput, context);

  if (decision.behavior === "deny") {
    return {
      output: decision.message ?? `Permission denied for tool "${name}"`,
      error: true,
    };
  }

  if (decision.behavior === "ask") {
    if (!onPermissionAsk) {
      return {
        output: decision.message ?? `Tool "${name}" requires permission`,
        error: true,
      };
    }

    const userResponse = await onPermissionAsk(decision);

    if (!userResponse.allowed) {
      return {
        output: `Permission denied by user for tool "${name}"`,
        error: true,
      };
    }

    // "Always allow" — add a session rule preserving content pattern if available
    if (userResponse.alwaysAllow) {
      const ruleValue: { toolName: string; ruleContent?: string } = { toolName: name };
      // If the decision came from a content-specific rule, preserve the pattern
      if (
        decision.reason &&
        typeof decision.reason === "object" &&
        "type" in decision.reason &&
        decision.reason.type === "rule"
      ) {
        const rule = (decision.reason as { type: string; rule: { value: { ruleContent?: string } } }).rule;
        if (rule?.value?.ruleContent) {
          ruleValue.ruleContent = rule.value.ruleContent;
        }
      }
      permissionManager.addRule({
        source: "session",
        behavior: "allow",
        value: ruleValue,
      });
    }
  }

  // Phase 3: execute
  try {
    return await tool.execute(
      parsed.data as Parameters<typeof tool.execute>[0],
      context,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { output: `Tool execution error: ${message}`, error: true };
  }
}
