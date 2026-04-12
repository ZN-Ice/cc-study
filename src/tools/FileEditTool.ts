/**
 * FileEditTool - Precise string replacement in files.
 *
 * References: free-code/src/tools/FileEditTool/FileEditTool.ts, utils.ts
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Tool, ToolResult, ToolContext } from "./types.js";

function applyEditToFile(
  originalContent: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string {
  const replaceFn = replaceAll
    ? (c: string, s: string, r: string) => c.replaceAll(s, () => r)
    : (c: string, s: string, r: string) => c.replace(s, () => r);

  if (newString !== "") {
    return replaceFn(originalContent, oldString, newString);
  }

  // Deleting: also remove trailing newline if oldString doesn't end with one
  const stripTrailingNewline =
    !oldString.endsWith("\n") && originalContent.includes(oldString + "\n");
  return stripTrailingNewline
    ? replaceFn(originalContent, oldString + "\n", newString)
    : replaceFn(originalContent, oldString, newString);
}

export const FileEditTool: Tool = {
  name: "Edit",
  description:
    "Performs exact string replacements in files. " +
    "Use this tool to edit files by specifying exactly what text to find (old_string) and what to replace it with (new_string). " +
    "The old_string must be an exact match and must be unique within the file (unless replace_all is true).",

  parameters: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "The absolute path to the file to modify",
      },
      old_string: {
        type: "string",
        description: "The text to replace",
      },
      new_string: {
        type: "string",
        description: "The text to replace it with (must be different from old_string)",
      },
      replace_all: {
        type: "boolean",
        description: "Replace all occurrences of old_string (default false)",
        default: false,
      },
    },
    required: ["file_path", "old_string", "new_string"],
  },

  requiresConfirmation: true,

  async execute(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const filePath = resolve(
      context.workingDirectory,
      String(params.file_path ?? ""),
    );
    const oldString = String(params.old_string ?? "");
    const newString = String(params.new_string ?? "");
    const replaceAll = Boolean(params.replace_all);

    if (oldString === newString) {
      return {
        output: "Error: old_string and new_string are identical. No changes needed.",
        error: true,
      };
    }

    // Read file
    let content: string;
    try {
      const buffer = await readFile(filePath);
      content = buffer.toString("utf-8");
      if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
      content = content.replace(/\r\n/g, "\n");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Creating new file with empty old_string
        if (oldString === "") {
          try {
            await writeFile(filePath, newString, "utf-8");
            return { output: `File created successfully at: ${filePath}` };
          } catch (writeErr) {
            return {
              output: `Error creating file: ${(writeErr as Error).message}`,
              error: true,
            };
          }
        }
        return { output: `Error: File not found: ${filePath}`, error: true };
      }
      return {
        output: `Error reading file: ${(err as Error).message}`,
        error: true,
      };
    }

    // Creating new file when file already exists
    if (oldString === "" && content.length > 0) {
      return {
        output: "Error: Cannot create new file - file already exists and is not empty.",
        error: true,
      };
    }

    // Check if old_string exists in file
    if (!content.includes(oldString)) {
      return {
        output: `Error: old_string not found in file. Make sure the string is an exact match.`,
        error: true,
      };
    }

    // Uniqueness check (non replace_all mode)
    if (!replaceAll) {
      const matchCount = content.split(oldString).length - 1;
      if (matchCount > 1) {
        return {
          output: `Error: Found ${matchCount} matches of old_string in file. Either provide more context to make it unique, or set replace_all to true.`,
          error: true,
        };
      }
    }

    // Apply edit
    const updatedContent = oldString === ""
      ? newString
      : applyEditToFile(content, oldString, newString, replaceAll);

    // Verify change
    if (updatedContent === content) {
      return {
        output: "Error: String not found in file. Failed to apply edit.",
        error: true,
      };
    }

    // Write back
    try {
      await writeFile(filePath, updatedContent, "utf-8");
    } catch (err) {
      return {
        output: `Error writing file: ${(err as Error).message}`,
        error: true,
      };
    }

    if (replaceAll) {
      const matchCount = content.split(oldString).length - 1;
      return {
        output: `The file ${filePath} has been updated. All ${matchCount} occurrences were successfully replaced.`,
      };
    }
    return { output: `The file ${filePath} has been updated successfully.` };
  },
};
