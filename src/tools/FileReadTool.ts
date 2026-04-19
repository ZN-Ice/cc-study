/**
 * FileReadTool - Read file contents with line numbers.
 *
 * References: free-code/src/tools/FileReadTool/FileReadTool.ts
 */

import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { z } from "zod";
import type { Tool, ToolResult, ToolContext, ValidationResult } from "./types.js";

const MAX_OUTPUT_SIZE = 256 * 1024; // 256KB

/** Zod schema for FileReadTool parameters */
const inputSchema = z.strictObject({
  file_path: z.string().describe("The absolute path to the file to read"),
  offset: z.number().optional().describe("The line number to start reading from (1-indexed, defaults to 1)"),
  limit: z.number().optional().describe("The number of lines to read"),
});

type FileReadInput = z.infer<typeof inputSchema>;

/** Add line numbers in cat -n format */
function addLineNumbers(content: string, startLine: number): string {
  if (!content) return "";
  return content
    .split("\n")
    .map((line, i) => `${String(i + startLine).padStart(6, " ")}→${line}`)
    .join("\n");
}

/** Check if a file extension indicates a binary (non-text) file */
function isBinaryExtension(ext: string): boolean {
  const binaryExtensions = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
    ".pdf", ".zip", ".tar", ".gz", ".bz2", ".xz",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".mp3", ".mp4", ".avi", ".mov", ".wav",
    ".exe", ".dll", ".so", ".dylib",
    ".class", ".jar", ".war",
    ".sqlite", ".db",
  ]);
  return binaryExtensions.has(ext.toLowerCase());
}

export const FileReadTool: Tool<typeof inputSchema> = {
  name: "Read",
  description:
    "Reads a file from the local filesystem. " +
    "You can access any file directly by using this tool. " +
    "Assume this tool is able to read all files on the machine. " +
    "If the User provides a path to a file assume that path is valid. " +
    "It is okay to read a file that does not exist; an error will be returned.",

  inputSchema,

  async validateInput(
    input: FileReadInput,
    context: ToolContext,
  ): Promise<ValidationResult> {
    const filePath = resolve(context.workingDirectory, input.file_path);

    // Check extension for binary files
    const ext = extname(filePath);
    if (isBinaryExtension(ext)) {
      return {
        ok: false,
        error: `Error: Cannot read binary file (${ext}). Only text files are supported.`,
      };
    }

    // Check file existence and size
    try {
      const stats = await stat(filePath);
      if (stats.size > MAX_OUTPUT_SIZE && input.limit === undefined) {
        return {
          ok: false,
          error: `Error: File content (${Math.round(stats.size / 1024)}KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions.`,
        };
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { ok: false, error: `Error: File not found: ${filePath}` };
      }
      if (code === "EACCES") {
        return { ok: false, error: `Error: Permission denied: ${filePath}` };
      }
      return {
        ok: false,
        error: `Error: Cannot read file: ${(err as Error).message}`,
      };
    }

    return { ok: true };
  },

  async execute(
    input: FileReadInput,
    context: ToolContext,
  ): Promise<ToolResult> {
    const filePath = resolve(context.workingDirectory, input.file_path);
    const offset = input.offset ?? 1;
    const limit = input.limit;

    // Read file
    let content: string;
    try {
      const buffer = await readFile(filePath);
      // Strip UTF-8 BOM
      content = buffer.toString("utf-8");
      if (content.charCodeAt(0) === 0xfeff) {
        content = content.slice(1);
      }
      // Normalize CRLF to LF
      content = content.replace(/\r\n/g, "\n");
    } catch (err) {
      return {
        output: `Error reading file: ${(err as Error).message}`,
        error: true,
      };
    }

    // Split into lines and apply offset/limit
    const allLines = content.split("\n");
    // Remove trailing empty line from final newline
    if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
      allLines.pop();
    }

    const lineOffset = Math.max(0, offset - 1);
    const endLine = limit != null ? lineOffset + limit : allLines.length;
    const selectedLines = allLines.slice(lineOffset, endLine);

    const result = addLineNumbers(selectedLines.join("\n"), offset);

    // Add file metadata header
    const header = `File: ${filePath} (${allLines.length} lines total)\n`;
    const footer =
      lineOffset > 0 || endLine < allLines.length
        ? `\n(showing lines ${offset}-${Math.min(endLine, allLines.length)} of ${allLines.length})`
        : "";

    return { output: header + result + footer };
  },
};
