/**
 * Tool system exports.
 *
 * Re-exports all types, the registry, and all tool implementations.
 */

export type { Tool, ToolResult, ToolContext, JSONSchema, ToolDefinition } from "./types.js";
export { ToolRegistry, executeTool } from "./registry.js";
export { FileReadTool } from "./FileReadTool.js";
export { FileWriteTool } from "./FileWriteTool.js";
export { FileEditTool } from "./FileEditTool.js";
export { BashTool } from "./BashTool.js";
export { GlobTool } from "./GlobTool.js";
export { GrepTool } from "./GrepTool.js";

import { ToolRegistry } from "./registry.js";
import { FileReadTool } from "./FileReadTool.js";
import { FileWriteTool } from "./FileWriteTool.js";
import { FileEditTool } from "./FileEditTool.js";
import { BashTool } from "./BashTool.js";
import { GlobTool } from "./GlobTool.js";
import { GrepTool } from "./GrepTool.js";

/** Create a registry with all core tools registered */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(FileReadTool);
  registry.register(FileWriteTool);
  registry.register(FileEditTool);
  registry.register(BashTool);
  registry.register(GlobTool);
  registry.register(GrepTool);
  return registry;
}
