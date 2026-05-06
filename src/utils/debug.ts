/**
 * Minimal debug logger gated by process.env.DEBUG.
 *
 * Set DEBUG=1 or DEBUG=teammate,agent to enable.
 * Namespaces are comma/space separated prefixes matched against the DEBUG value.
 *
 * Logs are also written to /tmp/cc-study-debug.log for file-based analysis.
 */
import { appendFileSync, mkdirSync } from "fs";

const DEBUG = process.env.DEBUG ?? "";
const LOG_FILE = "/tmp/cc-study-debug.log";

// Ensure log directory exists
try {
  mkdirSync("/tmp", { recursive: true });
} catch {
  // ignore
}

function debugEnabled(namespace: string): boolean {
  if (!DEBUG) return false;
  if (DEBUG === "1" || DEBUG === "*" || DEBUG === "true") return true;
  const patterns = DEBUG.split(/[\s,]+/).filter(Boolean);
  return patterns.some((p) => namespace.startsWith(p) || p.startsWith(namespace));
}

function writeLog(label: string, args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
  const line = `${timestamp} ${label} ${msg}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // ignore write errors
  }
}

export function createDebug(namespace: string): (...args: unknown[]) => void {
  const label = `[${namespace}]`;
  return (...args: unknown[]) => {
    if (debugEnabled(namespace)) {
      writeLog(label, args);
    }
  };
}
