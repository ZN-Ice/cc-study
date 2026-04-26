/**
 * Hook configuration loading from settings.json.
 *
 * Hooks can be configured in the settings.json file under the "hooks" key.
 * The settings file stores hook metadata (name, type, enabled), not the actual
 * hook implementations. Hook implementations are registered programmatically.
 */

import { readFile } from "node:fs/promises";

/**
 * Hook settings stored in settings.json (hook metadata only).
 * Actual hook implementations are registered separately by name.
 */
export interface HookSettings {
  preToolUse?: Array<{
    name: string;
    enabled?: boolean;
  }>;
  postToolUse?: Array<{
    name: string;
    enabled?: boolean;
  }>;
  stop?: Array<{
    name: string;
    enabled?: boolean;
  }>;
}

/**
 * Full hook config structure as stored in settings.json
 */
interface RawHookSettings {
  hooks?: HookSettings;
}

/**
 * Load hook settings from a settings.json file.
 * Returns empty settings if file doesn't exist or has no hooks key.
 */
export async function loadHookConfigFromFile(
  filePath: string,
): Promise<HookSettings> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const json = JSON.parse(raw) as RawHookSettings;
    return json.hooks ?? {};
  } catch {
    return {};
  }
}
