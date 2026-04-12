/**
 * GrepTool - Search file contents using ripgrep.
 *
 * References: free-code/src/tools/GrepTool/GrepTool.ts
 *
 * Uses child_process to call the system `rg` (ripgrep) binary.
 * Falls back to a basic Node.js implementation if ripgrep is not available.
 */

import { spawn } from "node:child_process";
import { resolve, relative } from "node:path";
import type { Tool, ToolResult, ToolContext } from "./types.js";

const DEFAULT_HEAD_LIMIT = 250;

async function hasRipgrep(): Promise<boolean> {
  return new Promise((res) => {
    const proc = spawn("rg", ["--version"], { stdio: "ignore" });
    proc.on("error", () => res(false));
    proc.on("close", (code) => res(code === 0));
  });
}

export const GrepTool: Tool = {
  name: "Grep",
  description:
    "Search file contents using regular expressions. " +
    "Supports output modes: content (show matching lines), files_with_matches (show file paths), count (show match counts). " +
    "Defaults to files_with_matches mode.",

  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The regular expression pattern to search for",
      },
      path: {
        type: "string",
        description: "File or directory to search in. Defaults to current working directory.",
      },
      glob: {
        type: "string",
        description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")',
      },
      output_mode: {
        type: "string",
        enum: ["content", "files_with_matches", "count"],
        description: 'Output mode (default: "files_with_matches")',
      },
      "-i": {
        type: "boolean",
        description: "Case insensitive search",
      },
      "-C": {
        type: "number",
        description: "Number of lines of context before and after matches",
      },
      head_limit: {
        type: "number",
        description: "Limit output to first N lines/entries (default 250)",
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

    const searchPath = params.path
      ? resolve(context.workingDirectory, String(params.path))
      : context.workingDirectory;
    const outputMode = String(params.output_mode ?? "files_with_matches");
    const caseInsensitive = Boolean(params["-i"]);
    const contextLines = Number(params["-C"] ?? 0);
    const globFilter = params.glob ? String(params.glob) : undefined;
    const headLimit = Number(params.head_limit ?? DEFAULT_HEAD_LIMIT);

    // Try ripgrep first
    const rgAvailable = await hasRipgrep();
    if (rgAvailable) {
      return executeWithRipgrep(
        pattern, searchPath, outputMode, caseInsensitive,
        contextLines, globFilter, headLimit, context.workingDirectory,
      );
    }

    // Fallback: use grep command
    return executeWithGrep(
      pattern, searchPath, outputMode, caseInsensitive,
      contextLines, globFilter, headLimit, context.workingDirectory,
    );
  },
};

async function executeWithRipgrep(
  pattern: string,
  searchPath: string,
  outputMode: string,
  caseInsensitive: boolean,
  contextLines: number,
  globFilter: string | undefined,
  headLimit: number,
  cwd: string,
): Promise<ToolResult> {
  const args: string[] = ["--hidden", "--max-columns", "500"];

  // Exclude VCS directories
  args.push("--glob", "!.git");

  if (caseInsensitive) args.push("-i");

  if (outputMode === "files_with_matches") {
    args.push("-l");
  } else if (outputMode === "count") {
    args.push("-c");
  } else {
    args.push("-n");
    if (contextLines > 0) args.push("-C", String(contextLines));
  }

  // Pattern with -e flag to handle patterns starting with dash
  args.push("-e", pattern);

  if (globFilter) args.push("--glob", globFilter);

  args.push(searchPath);

  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn("rg", args, { stdio: ["pipe", "pipe", "pipe"] });

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      // ripgrep exit 1 = no matches (not an error)
      if (code === 1 && !stderr) {
        resolveResult({ output: outputMode === "files_with_matches" ? "No files found" : "No matches found" });
        return;
      }
      if (code !== null && code > 1) {
        resolveResult({ output: `Error: ${stderr || "ripgrep failed"}`, error: true });
        return;
      }

      const lines = stdout.trim().split("\n").filter(Boolean);
      const limited = headLimit > 0 ? lines.slice(0, headLimit) : lines;

      // Relativize paths
      const processed = limited.map((line) => {
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          const filePath = line.substring(0, colonIdx);
          const rest = line.substring(colonIdx);
          return relative(cwd, filePath) + rest;
        }
        return line;
      });

      if (outputMode === "files_with_matches") {
        const files = processed.map((line) => {
          const colonIdx = line.indexOf(":");
          return colonIdx > 0 ? line.substring(0, colonIdx) : line;
        });
        const unique = [...new Set(files)];
        resolveResult({
          output: `Found ${unique.length} file${unique.length === 1 ? "" : "s"}\n${unique.join("\n")}`,
        });
        return;
      }

      resolveResult({ output: processed.join("\n") || "No matches found" });
    });

    proc.on("error", (err) => {
      resolveResult({ output: `Error: ${err.message}`, error: true });
    });

    proc.stdin.end();
  });
}

async function executeWithGrep(
  pattern: string,
  searchPath: string,
  outputMode: string,
  caseInsensitive: boolean,
  contextLines: number,
  globFilter: string | undefined,
  headLimit: number,
  cwd: string,
): Promise<ToolResult> {
  const args: string[] = ["-n"];

  if (caseInsensitive) args.push("-i");
  if (outputMode === "files_with_matches") args.push("-l");
  if (outputMode === "count") args.push("-c");
  if (contextLines > 0) args.push("-C", String(contextLines));
  if (globFilter) args.push("--include", globFilter);

  args.push("-E", pattern, searchPath);

  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn("grep", ["-r", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code === 1 && !stderr) {
        resolveResult({ output: "No matches found" });
        return;
      }
      if (code !== null && code > 1) {
        resolveResult({ output: `Error: ${stderr || "grep failed"}`, error: true });
        return;
      }

      const lines = stdout.trim().split("\n").filter(Boolean);
      const limited = headLimit > 0 ? lines.slice(0, headLimit) : lines;

      // Relativize paths
      const processed = limited.map((line) => {
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          const filePath = line.substring(0, colonIdx);
          const rest = line.substring(colonIdx);
          return relative(cwd, filePath) + rest;
        }
        return line;
      });

      if (outputMode === "files_with_matches") {
        const files = processed.map((line) => {
          const colonIdx = line.indexOf(":");
          return colonIdx > 0 ? line.substring(0, colonIdx) : line;
        });
        const unique = [...new Set(files)];
        resolveResult({
          output: `Found ${unique.length} file${unique.length === 1 ? "" : "s"}\n${unique.join("\n")}`,
        });
        return;
      }

      resolveResult({ output: processed.join("\n") || "No matches found" });
    });

    proc.on("error", (err) => {
      resolveResult({ output: `Error: ${err.message}`, error: true });
    });

    proc.stdin.end();
  });
}
