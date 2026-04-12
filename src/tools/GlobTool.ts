/**
 * GlobTool - File pattern matching using fast-glob.
 *
 * References: free-code/src/tools/GlobTool/GlobTool.ts
 */

import { resolve, relative } from "node:path";
import { stat } from "node:fs/promises";
import fg from "fast-glob";
import type { Tool, ToolResult, ToolContext } from "./types.js";

const MAX_RESULTS = 100;

export const GlobTool: Tool = {
  name: "Glob",
  description:
    "Fast file pattern matching tool that works with any codebase size. " +
    "Supports glob patterns like \"**/*.js\" or \"src/**/*.ts\". " +
    "Returns matching file paths sorted by modification time. " +
    "Defaults to the current working directory.",

  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The glob pattern to match files against",
      },
      path: {
        type: "string",
        description: "The directory to search in. Defaults to current working directory.",
      },
    },
    required: ["pattern"],
  },

  async execute(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const pattern = String(params.pattern ?? "");
    if (!pattern) {
      return { output: "Error: pattern is required", error: true };
    }

    const searchDir = params.path
      ? resolve(context.workingDirectory, String(params.path))
      : context.workingDirectory;

    try {
      const files = await fg(pattern, {
        cwd: searchDir,
        absolute: true,
        ignore: ["**/node_modules/**", "**/.git/**"],
        onlyFiles: true,
        suppressErrors: true,
      });

      if (files.length === 0) {
        return { output: "No files found" };
      }

      // Sort by modification time (most recent first)
      const withStats = await Promise.all(
        files.map(async (file) => {
          try {
            const s = await stat(file);
            return { file, mtimeMs: s.mtimeMs };
          } catch {
            return { file, mtimeMs: 0 };
          }
        }),
      );

      withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

      const truncated = withStats.length > MAX_RESULTS;
      const results = withStats.slice(0, MAX_RESULTS);

      const relativePaths = results.map((r) =>
        relative(context.workingDirectory, r.file),
      );

      let output = relativePaths.join("\n");
      if (truncated) {
        output += `\n\n(Results are truncated. Consider using a more specific path or pattern.)`;
      }

      return { output };
    } catch (err) {
      return {
        output: `Error: ${(err as Error).message}`,
        error: true,
      };
    }
  },
};
