/**
 * BashTool - Execute shell commands.
 *
 * References: free-code/src/tools/BashTool/BashTool.tsx, free-code/src/utils/Shell.ts
 */

import { spawn } from "node:child_process";
import type { Tool, ToolResult, ToolContext } from "./types.js";

const DEFAULT_TIMEOUT = 120_000; // 120 seconds

export const BashTool: Tool = {
  name: "Bash",
  description:
    "Executes a given bash command. " +
    "The command will run in a shell process with the working directory set to the project root. " +
    "Commands have a default timeout of 120 seconds. " +

    "IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. " +
    "Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, " +
    "or detection evasion for malicious purposes.",

  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The bash command to execute",
      },
      timeout: {
        type: "number",
        description: "Optional timeout in milliseconds (default 120000, max 600000)",
      },
    },
    required: ["command"],
  },

  requiresConfirmation: true,

  async execute(
    params: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const command = String(params.command ?? "");
    if (!command.trim()) {
      return { output: "Error: Empty command", error: true };
    }

    const timeout = Math.min(
      Number(params.timeout ?? DEFAULT_TIMEOUT),
      600_000,
    );

    return new Promise((resolveResult) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const proc = spawn("sh", ["-c", command], {
        cwd: context.workingDirectory,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        // Give process 5 seconds to gracefully exit
        setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch { /* ignore */ }
        }, 5000);
      }, timeout);

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle abort signal
      const onAbort = () => {
        timedOut = true;
        proc.kill("SIGTERM");
      };
      if (context.abortSignal.aborted) {
        onAbort();
      } else {
        context.abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      proc.on("close", (code) => {
        clearTimeout(timer);
        context.abortSignal.removeEventListener("abort", onAbort);

        const output: string[] = [];
        if (stdout) output.push(stdout);
        if (stderr) output.push(stderr);

        if (timedOut) {
          resolveResult({
            output: `Command timed out after ${timeout / 1000} seconds.\n${output.join("\n")}`,
            error: true,
          });
          return;
        }

        const combined = output.join("\n") || "(no output)";
        const exitCode = code ?? 0;
        if (exitCode !== 0) {
          resolveResult({
            output: `Exit code: ${exitCode}\n${combined}`,
            error: true,
          });
          return;
        }

        resolveResult({ output: combined });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        context.abortSignal.removeEventListener("abort", onAbort);
        resolveResult({
          output: `Error executing command: ${err.message}`,
          error: true,
        });
      });

      // Close stdin
      proc.stdin.end();
    });
  },
};
