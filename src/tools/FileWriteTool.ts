/**
 * FileWriteTool - Write content to a file.
 *
 * References: free-code/src/tools/FileWriteTool/FileWriteTool.ts
 */

import { writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Tool, ToolResult, ToolContext } from "./types.js";

export const FileWriteTool: Tool = {
  name: "Write",
  description:
    "Writes a file to the local filesystem. " +
    "This tool will overwrite the existing file if there is one at the provided path. " +
    "If this is an existing file, you MUST use the Read tool first to read the file's contents. " +
    "This tool will fail if you did not read the file first.",

  parameters: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "The absolute path to the file to write (must be absolute, not relative)",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
    required: ["file_path", "content"],
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
    const content = String(params.content ?? "");

    if (!params.file_path) {
      return { output: "Error: file_path is required", error: true };
    }

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

    // Write file (atomic: write to tmp then rename)
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
