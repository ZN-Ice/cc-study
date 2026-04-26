/**
 * Built-in /memory command
 * Reference: free-code/src/commands/memory/memory.tsx
 *
 * Opens the memory file editor for managing persistent memory.
 *
 * Memory files are stored in:
 * ~/.claude/projects/{project-id}/memory/
 *
 * Memory types:
 * - user: User preferences and habits
 * - feedback: User corrections and preferences
 * - project: Project-specific information
 * - reference: External system references
 *
 * MEMORY.md serves as the index file that tracks all memory entries.
 */

import type { Command, CommandContext, LocalCommandResult, SubCommand } from "../types.js";

// Memory sub-commands with nested actions
const memorySubCommands: SubCommand[] = [
  {
    name: "user",
    description: "User preferences and habits",
    completesCommand: false,
    subCommands: [
      { name: "write", description: "Write to user memory", completesCommand: false },
    ],
  },
  {
    name: "feedback",
    description: "User corrections and preferences",
    completesCommand: false,
    subCommands: [
      { name: "write", description: "Write to feedback memory", completesCommand: false },
    ],
  },
  {
    name: "project",
    description: "Project-specific information",
    completesCommand: false,
    subCommands: [
      { name: "write", description: "Write to project memory", completesCommand: false },
    ],
  },
  {
    name: "reference",
    description: "External system references",
    completesCommand: false,
    subCommands: [
      { name: "write", description: "Write to reference memory", completesCommand: false },
    ],
  },
]
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { homedir } from "os";

export const memoryCommand: Command = {
  type: "local",
  name: "memory",
  description: "Manage persistent memory files",
  argumentHint: "[type] [write <content>]",
  whenToUse: "When you want to view or edit your memory files.",
  isEnabled: () => true,
  isHidden: false,
  userInvocable: true,
  supportsNonInteractive: true,
  subCommands: memorySubCommands,
  load: async () => {
    return { call: memoryCall };
  },
};

type MemoryType = "user" | "feedback" | "project" | "reference";

interface MemoryEntry {
  name: string;
  description: string;
  type: MemoryType;
  filePath: string;
}

/**
 * Get the memory base path for a project.
 */
export function getMemoryBasePath(projectId = "default"): string {
  return path.join(
    homedir(),
    ".claude",
    "projects",
    projectId,
    "memory",
  );
}

/**
 * Get the MEMORY.md index file path.
 */
export function getMemoryIndexPath(projectId = "default"): string {
  return path.join(
    homedir(),
    ".claude",
    "projects",
    projectId,
    "MEMORY.md",
  );
}

/**
 * Get the memory file path for a specific type.
 */
export function getMemoryFilePath(
  basePath: string,
  type: MemoryType,
): string {
  return path.join(basePath, `${type}.md`);
}

/**
 * Get the memory type from a string input.
 */
export function getMemoryType(input: string): MemoryType | null {
  const normalized = input.toLowerCase();
  if (["user", "feedback", "project", "reference"].includes(normalized)) {
    return normalized as MemoryType;
  }
  return null;
}

/**
 * Ensure the memory directory exists.
 */
async function ensureMemoryDir(basePath: string): Promise<void> {
  await fs.mkdir(basePath, { recursive: true });
}

/**
 * Read a memory file.
 */
async function readMemoryFile(
  filePath: string,
  type: MemoryType,
): Promise<string> {
  try {
    await fs.access(filePath);
    const content = await fs.readFile(filePath, "utf-8");
    return `# Memory: ${type}\n\n${content}`;
  } catch {
    return `# Memory: ${type}\n\n(No content yet. This file will be created when you write to it.)`;
  }
}

/**
 * Write content to a memory file and update the index.
 */
async function writeMemoryFile(
  basePath: string,
  indexPath: string,
  type: MemoryType,
  content: string,
): Promise<string> {
  await ensureMemoryDir(basePath);

  const filePath = getMemoryFilePath(basePath, type);
  await fs.writeFile(filePath, content, "utf-8");

  // Update the MEMORY.md index
  await updateMemoryIndex(basePath, indexPath);

  return `Memory "${type}" updated successfully.`;
}

/**
 * Update the MEMORY.md index file.
 */
async function updateMemoryIndex(
  basePath: string,
  indexPath: string,
): Promise<void> {
  const types: MemoryType[] = ["user", "feedback", "project", "reference"];
  const entries: MemoryEntry[] = [];

  for (const type of types) {
    const filePath = getMemoryFilePath(basePath, type);
    let description = `${type} memory`;

    try {
      // Try to read the first line as description
      const content = await fs.readFile(filePath, "utf-8");
      const firstLine = content.split("\n").find((line) => line.trim() !== "");
      if (firstLine && firstLine.startsWith("#")) {
        description = firstLine.replace(/^#+\s*/, "").trim();
      }
    } catch {
      // File doesn't exist, use default description
    }

    entries.push({
      name: `${type}_memory`,
      description,
      type,
      filePath,
    });
  }

  const indexContent = buildMemoryIndexContent(entries);
  await ensureMemoryDir(path.dirname(indexPath));
  await fs.writeFile(indexPath, indexContent, "utf-8");
}

/**
 * Build the MEMORY.md index content.
 */
function buildMemoryIndexContent(entries: MemoryEntry[]): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push("name: memory_index");
  lines.push('description: "Memory index file tracking all memory entries"');
  lines.push('type: "index"');
  lines.push("---");
  lines.push("");
  lines.push("# Memory Index");
  lines.push("");
  lines.push("This file tracks all persistent memory entries.");
  lines.push("");
  lines.push("## Memory Types");
  lines.push("");

  for (const entry of entries) {
    const status = fsSync.existsSync(entry.filePath) ? "*(exists)*" : "*(not created)*";
    lines.push(`- **${entry.type}** ${status} - ${entry.description}`);
  }

  lines.push("");
  lines.push("## Usage");
  lines.push("");
  lines.push("- `/memory user` - View user preferences memory");
  lines.push("- `/memory feedback` - View feedback memory");
  lines.push("- `/memory project` - View project memory");
  lines.push("- `/memory reference` - View reference memory");
  lines.push("- `/memory <type> write <content>` - Write to a memory file");
  lines.push("");

  return lines.join("\n");
}

/**
 * Parse the command arguments.
 * Supports: /memory, /memory <type>, /memory <type> write <content>
 */
function parseMemoryArgs(
  args: string,
): { type: MemoryType | null; action: "read" | "write"; content: string } {
  const trimmed = args.trim();
  if (!trimmed) {
    return { type: null, action: "read", content: "" };
  }

  const parts = trimmed.split(/\s+/);
  const firstPart = parts[0];
  const memoryType = getMemoryType(firstPart);

  if (!memoryType) {
    return { type: null, action: "read", content: "" };
  }

  // Check if this is a write command
  if (parts.length > 1 && parts[1].toLowerCase() === "write") {
    const content = parts.slice(2).join(" ");
    return { type: memoryType, action: "write", content };
  }

  return { type: memoryType, action: "read", content: "" };
}

async function memoryCall(
  args: string,
  _context: CommandContext,
): Promise<LocalCommandResult> {
  const { type, action, content } = parseMemoryArgs(args);
  const projectId = "default";
  const memoryBasePath = getMemoryBasePath(projectId);
  const memoryIndexPath = getMemoryIndexPath(projectId);

  // If a specific memory type is requested
  if (type) {
    if (action === "write") {
      if (!content) {
        return {
          type: "text",
          value: `Error: No content provided to write to "${type}" memory.`,
        };
      }
      const result = await writeMemoryFile(
        memoryBasePath,
        memoryIndexPath,
        type,
        content,
      );
      return { type: "text", value: result };
    }

    // Read action
    const filePath = getMemoryFilePath(memoryBasePath, type);
    const result = await readMemoryFile(filePath, type);
    return { type: "text", value: result };
  }

  // Show memory overview
  return {
    type: "text",
    value: buildMemoryOverview(memoryBasePath),
  };
}

function buildMemoryOverview(memoryBasePath: string): string {
  const types: MemoryType[] = ["user", "feedback", "project", "reference"];
  const lines: string[] = [];

  lines.push("# Memory");
  lines.push("");
  lines.push("Persistent memory files for storing information across sessions.");
  lines.push("");
  lines.push("## Memory Types");
  lines.push("");

  for (const type of types) {
    const filePath = getMemoryFilePath(memoryBasePath, type);
    let status = "*(not created)*";
    try {
      fsSync.accessSync(filePath);
      status = "*(exists)*";
    } catch {
      // File doesn't exist
    }
    lines.push(`- **${type}** ${status}`);
  }

  lines.push("");
  lines.push("## Usage");
  lines.push("");
  lines.push("- `/memory user` - View user preferences memory");
  lines.push("- `/memory feedback` - View feedback memory");
  lines.push("- `/memory project` - View project memory");
  lines.push("- `/memory reference` - View reference memory");
  lines.push("- `/memory <type> write <content>` - Write content to a memory file");
  lines.push("");
  lines.push("## Examples");
  lines.push("");
  lines.push("`/memory user write My preferred coding style is...`");
  lines.push("`/memory feedback write The user prefers...`");

  return lines.join("\n");
}

// Export utility functions for testing
export { buildMemoryOverview, parseMemoryArgs };
