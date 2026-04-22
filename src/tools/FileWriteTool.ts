/**
 * FileWriteTool - Write content to a file.
 *
 * References: free-code/src/tools/FileWriteTool/FileWriteTool.ts
 */

import { writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { Tool, ToolResult, ToolContext, ValidationResult } from "./types.js";

/** Zod schema for FileWriteTool parameters */
const inputSchema = z.strictObject({
  file_path: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
  content: z.string().describe("The content to write to the file"),
});

type FileWriteInput = z.infer<typeof inputSchema>;

export const FileWriteTool: Tool<typeof inputSchema> = {
  name: "Write",
  description:
    "Writes a file to the local filesystem. " +
    "This tool will overwrite the existing file if there is one at the provided path. " +
    "If this is an existing file, you MUST use the Read tool first to read the file's contents. " +
    "This tool will fail if you did not read the file first.",

  inputSchema,

  requiresConfirmation: true,

  async validateInput(
    _input: FileWriteInput,
    _context: ToolContext,
  ): Promise<ValidationResult> {
    return { ok: true };
  },

  isSearchOrReadCommand(_input: FileWriteInput): {
    isSearch: boolean;
    isRead: boolean;
  } {
    return { isSearch: false, isRead: false };
  },

  async execute(
    input: FileWriteInput,
    context: ToolContext,
  ): Promise<ToolResult> {
    const filePath = resolve(context.workingDirectory, input.file_path);
    const content = input.content;

    // Ensure parent directory exists
    const dir = dirname(filePath);
    try {
      await mkdir(dir, { recursive: true });
    } catch (err) {
      return {
        output: `Error creating directory: ${(err as Error).message}`,
        error: true,
      };
    }

    // Check if file exists for create vs update distinction
    let isUpdate = false;
    try {
      await stat(filePath);
      isUpdate = true;
    } catch {
      // File doesn't exist - creating new
    }

    // Write file
    try {
      await writeFile(filePath, content, "utf-8");
    } catch (err) {
      return {
        output: `Error writing file: ${(err as Error).message}`,
        error: true,
      };
    }

    const lineCount = content.split("\n").length;
    if (isUpdate) {
      return {
        output: `The file ${filePath} has been updated successfully. (${lineCount} lines)`,
      };
    }
    return {
      output: `File created successfully at: ${filePath} (${lineCount} lines)`,
    };
  },
};
