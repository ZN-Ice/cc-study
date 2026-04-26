/**
 * FileEditTool - Precise string replacement in files.
 *
 * References: free-code/src/tools/FileEditTool/FileEditTool.ts, utils.ts
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { Tool, ToolResult, ToolContext, ValidationResult } from "./types.js";

/** Zod schema for FileEditTool parameters */
const inputSchema = z.strictObject({
  file_path: z.string().describe("The absolute path to the file to modify"),
  old_string: z.string().describe("The text to replace"),
  new_string: z.string().describe("The text to replace it with (must be different from old_string)"),
  replace_all: z.boolean().optional().describe("Replace all occurrences of old_string (default false)"),
});

type FileEditInput = z.infer<typeof inputSchema>;

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

export const FileEditTool: Tool<typeof inputSchema> = {
  name: "Edit",
  description:
    "Performs exact string replacements in files. " +
    "Use this tool to edit files by specifying exactly what text to find (old_string) and what to replace it with (new_string). " +
    "The old_string must be an exact match and must be unique within the file (unless replace_all is true).",

  getPath(input: FileEditInput): string | undefined {
    return input.file_path;
  },

  inputSchema,

  requiresConfirmation: true,

  async validateInput(
    input: FileEditInput,
    context: ToolContext,
  ): Promise<ValidationResult> {
    const filePath = resolve(context.workingDirectory, input.file_path);
    const oldString = input.old_string;
    const newString = input.new_string;

    // Check: old_string and new_string must differ
    if (oldString === newString) {
      return {
        ok: false,
        error: "Error: old_string and new_string are identical. No changes needed.",
      };
    }

    // Read file for semantic validation
    let content: string;
    try {
      const buffer = await readFile(filePath);
      content = buffer.toString("utf-8");
      if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
      content = content.replace(/\r\n/g, "\n");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Creating new file is only valid when old_string is empty
        if (oldString === "") {
          return { ok: true };
        }
        return { ok: false, error: `Error: File not found: ${filePath}` };
      }
      return {
        ok: false,
        error: `Error reading file: ${(err as Error).message}`,
      };
    }

    // Creating new file when file already exists
    if (oldString === "" && content.length > 0) {
      return {
        ok: false,
        error: "Error: Cannot create new file - file already exists and is not empty.",
      };
    }

    // Empty old_string means creating a new file (already handled above)
    if (oldString === "") {
      return { ok: true };
    }

    // Check if old_string exists in file
    if (!content.includes(oldString)) {
      return {
        ok: false,
        error: "Error: old_string not found in file. Make sure the string is an exact match.",
      };
    }

    // Uniqueness check (non replace_all mode)
    const replaceAll = input.replace_all ?? false;
    if (!replaceAll) {
      const matchCount = content.split(oldString).length - 1;
      if (matchCount > 1) {
        return {
          ok: false,
          error: `Error: Found ${matchCount} matches of old_string in file. Either provide more context to make it unique, or set replace_all to true.`,
        };
      }
    }

    return { ok: true };
  },

  isSearchOrReadCommand(_input: FileEditInput): {
    isSearch: boolean;
    isRead: boolean;
  } {
    return { isSearch: false, isRead: false };
  },

  async execute(
    input: FileEditInput,
    context: ToolContext,
  ): Promise<ToolResult> {
    const filePath = resolve(context.workingDirectory, input.file_path);
    const oldString = input.old_string;
    const newString = input.new_string;
    const replaceAll = input.replace_all ?? false;

    // Read file (already validated, but we need the content)
    let content: string;
    try {
      const buffer = await readFile(filePath);
      content = buffer.toString("utf-8");
      if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
      content = content.replace(/\r\n/g, "\n");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" && oldString === "") {
        // Creating new file
        try {
          await writeFile(filePath, newString, "utf-8");
          return {
            output: `File created successfully at: ${filePath}`,
            metadata: { path: filePath, action: "create" },
          };
        } catch (writeErr) {
          return {
            output: `Error creating file: ${(writeErr as Error).message}`,
            error: true,
          };
        }
      }
      return {
        output: `Error reading file: ${(err as Error).message}`,
        error: true,
      };
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
        metadata: { path: filePath, action: "replace_all", replacements: matchCount },
      };
    }
    return {
      output: `The file ${filePath} has been updated successfully.`,
      metadata: { path: filePath, action: "edit", replacements: 1 },
    };
  },
};
