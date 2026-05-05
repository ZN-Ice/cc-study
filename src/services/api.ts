import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "../messages.js";
import { normalizeForAPI } from "../messages.js";
import type { ToolDefinition } from "../tools/types.js";
import { createDebug } from "../utils/debug.js";

const debug = createDebug("api");

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface APIConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly systemPrompt: string;
  readonly temperature: number;
  readonly tools?: readonly ToolDefinition[];
  /**
   * Timeout in milliseconds for the entire API request (fetch + stream).
   * Default: 300_000 (5 minutes). Set to 0 to disable.
   */
  readonly requestTimeout?: number;
}

/** Token usage info from API message_start event */
export interface APIUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

export interface MessageStartEvent {
  readonly type: "message_start";
  readonly message: {
    readonly id: string;
    readonly model?: string;
    readonly usage?: APIUsage;
  };
}

export interface ContentBlockStartEvent {
  readonly type: "content_block_start";
  readonly index: number;
  readonly content_block: {
    readonly type: string;
    readonly text?: string;
    readonly id?: string;
    readonly name?: string;
    readonly input?: Record<string, unknown>;
  };
}

export interface ContentBlockDeltaEvent {
  readonly type: "content_block_delta";
  readonly index: number;
  readonly delta: {
    readonly type: string;
    readonly text?: string;
    readonly partial_json?: string;
  };
}

export interface ContentBlockStopEvent {
  readonly type: "content_block_stop";
  readonly index: number;
}

export interface MessageDeltaEvent {
  readonly type: "message_delta";
  readonly delta: { readonly stop_reason?: string };
}

export interface MessageStopEvent {
  readonly type: "message_stop";
}

export type StreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent;

// ──────────────────────────────────────────────
// SSE Stream Parser
// ──────────────────────────────────────────────

/**
 * Parse a Server-Sent Events stream from a Response.
 * Yields parsed JSON events, skipping non-data lines.
 *
 * @param chunkTimeoutMs Max milliseconds to wait for a single chunk before
 *   aborting. Default: 60_000 (60s). Prevents indefinite hangs when the
 *   server stops sending data but keeps the connection open.
 */
export async function* parseSSEStream(
  response: Response,
  chunkTimeoutMs = 60_000,
): AsyncGenerator<StreamEvent, void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      // Race the read against a per-chunk timeout
      const readPromise = reader.read();
      const timeoutPromise = new Promise<never>((_, reject) => {
        const id = setTimeout(
          () => reject(new DOMException("Stream read timeout", "TimeoutError")),
          chunkTimeoutMs,
        );
        // Allow the timeout to be cancelled if the read completes first
        readPromise.then(
          () => clearTimeout(id),
          () => clearTimeout(id),
        );
      });

      const { done, value } = await Promise.race([readPromise, timeoutPromise]);
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") return;

        yield JSON.parse(data) as StreamEvent;
      }
    }

    // Process any remaining buffer
    if (buffer.trim().startsWith("data: ")) {
      const data = buffer.trim().slice(6);
      if (data !== "[DONE]") {
        yield JSON.parse(data) as StreamEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ──────────────────────────────────────────────
// Stream Chat
// ──────────────────────────────────────────────

const DEFAULT_API_URL = "https://api.anthropic.com/v1/messages";

interface SettingsEnv {
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
}

/**
 * Read env overrides from ~/.claude/settings.json.
 * Returns an empty object if the file is missing or invalid.
 */
function readSettingsEnv(): SettingsEnv {
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    const raw = readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(raw) as { env?: Record<string, string> };
    const env = settings.env ?? {};
    return {
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN,
    };
  } catch {
    return {};
  }
}

/**
 * Resolve the API URL: settings.json > default.
 */
export function resolveApiUrl(): string {
  const env = readSettingsEnv();
  if (env.ANTHROPIC_BASE_URL) {
    return `${env.ANTHROPIC_BASE_URL.replace(/\/+$/, "")}/v1/messages`;
  }
  return DEFAULT_API_URL;
}

/**
 * Resolve the API key: settings.json > env var ANTHROPIC_API_KEY.
 */
export function resolveApiKey(): string {
  const env = readSettingsEnv();
  return env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? "";
}

const ANTHROPIC_API_URL = resolveApiUrl();

/**
 * Stream a chat completion from the Anthropic API.
 *
 * Uses raw fetch + SSE parsing instead of the SDK,
 * so we deeply understand the streaming protocol.
 *
 * Applies a request-level timeout (default 5 min) and a per-chunk
 * timeout (60s) to prevent indefinite hangs on stalled connections.
 */
export async function* streamChat(
  messages: readonly Message[],
  config: APIConfig,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent, void> {
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: config.systemPrompt,
    messages: normalizeForAPI(messages),
    stream: true,
  };

  if (config.tools && config.tools.length > 0) {
    body.tools = config.tools;
  }

  // Combine the caller's abort signal with a request-level timeout
  const requestTimeoutMs = config.requestTimeout ?? 300_000; // 5 minutes
  const fetchSignal = requestTimeoutMs > 0
    ? AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)])
    : signal;

  const t0 = Date.now();
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: fetchSignal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `API request failed: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  debug("fetch done in %dms, starting SSE parse", Date.now() - t0);
  yield* parseSSEStream(response);
  debug("stream done, total=%dms", Date.now() - t0);
}
