/**
 * Tool registry: register, discover, and manage tools.
 *
 * References: free-code/src/tools.ts
 */

import { z } from "zod";
import type { Tool, ToolDefinition, ToolResult, ToolContext } from "./types.js";

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
