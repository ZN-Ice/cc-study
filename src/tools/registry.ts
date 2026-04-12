/**
 * Tool registry: register, discover, and manage tools.
 *
 * References: free-code/src/tools.ts
 */

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
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object" as const,
        properties: tool.parameters.properties ?? {},
        required: tool.parameters.required ?? [],
      },
    }));
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
 * Execute a tool by name using the given registry.
 */
export async function executeTool(
  registry: ToolRegistry,
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const tool = registry.get(name);
  if (!tool) {
    return {
      output: `Unknown tool: ${name}`,
      error: true,
    };
  }

  try {
    return await tool.execute(input, context);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: `Tool execution error: ${message}`,
      error: true,
    };
  }
}
