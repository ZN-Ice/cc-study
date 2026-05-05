/**
 * Minimal debug logger gated by process.env.DEBUG.
 *
 * Set DEBUG=1 or DEBUG=teammate,agent to enable.
 * Namespaces are comma/space separated prefixes matched against the DEBUG value.
 */
const DEBUG = process.env.DEBUG ?? "";

function debugEnabled(namespace: string): boolean {
  if (!DEBUG) return false;
  if (DEBUG === "1" || DEBUG === "*" || DEBUG === "true") return true;
  const patterns = DEBUG.split(/[\s,]+/).filter(Boolean);
  return patterns.some((p) => namespace.startsWith(p) || p.startsWith(namespace));
}

export function createDebug(namespace: string): (...args: unknown[]) => void {
  const label = `[${namespace}]`;
  return (...args: unknown[]) => {
    if (debugEnabled(namespace)) {
      console.error(label, ...args);
    }
  };
}
