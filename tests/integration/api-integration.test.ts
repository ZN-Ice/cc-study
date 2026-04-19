/**
 * Integration test for API streaming.
 * Tests the actual API connection using settings.json config.
 *
 * Requires network access and a valid API key in ~/.claude/settings.json.
 * Skipped automatically if ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY is missing.
 */
import { describe, test, expect } from "vitest";
import {
  streamChat,
  resolveApiUrl,
  resolveApiKey,
  type APIConfig,
  type StreamEvent,
  type ContentBlockDeltaEvent,
} from "../../src/services/api.js";
import { createUserMessage } from "../../src/messages.js";
import { createDefaultRegistry } from "../../src/tools/index.js";

const apiKey = resolveApiKey();
const hasApiKey = apiKey.length > 0;

describe.skipIf(!hasApiKey)("API Integration", () => {
  const registry = createDefaultRegistry();

  const config: APIConfig = {
    apiKey,
    model: "claude-sonnet-4-6",
    maxTokens: 256,
    systemPrompt: "You are a helpful assistant. Reply concisely.",
    temperature: 0,
  };

  const configWithTools: APIConfig = {
    ...config,
    maxTokens: 1024,
    tools: registry.getToolDefinitions(),
  };

  test("resolveApiUrl returns a valid URL", () => {
    const url = resolveApiUrl();
    expect(url).toContain("/v1/messages");
    console.log(`  API URL: ${url}`);
  });

  test("streamChat returns a complete response for '你好'", async () => {
    const controller = new AbortController();
    const events: StreamEvent[] = [];
    let fullText = "";

    const messages = [createUserMessage("你好")];

    for await (const event of streamChat(messages, config, controller.signal)) {
      events.push(event);

      if (event.type === "content_block_delta") {
        const delta = event as ContentBlockDeltaEvent;
        if (delta.delta.text) {
          fullText += delta.delta.text;
        }
      }
    }

    console.log(`  Response: ${fullText}`);

    // Verify event sequence: message_start ... message_stop
    expect(events[0].type).toBe("message_start");
    expect(events.some((e) => e.type === "message_stop")).toBe(true);

    // Verify content
    expect(fullText.length).toBeGreaterThan(0);
  });

  test("streamChat handles abort signal", async () => {
    const controller = new AbortController();
    // Abort after a short delay
    setTimeout(() => controller.abort(), 200);

    const messages = [createUserMessage("写一篇10000字的文章")];

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _event of streamChat(messages, config, controller.signal)) {
        // consume
      }
    }).rejects.toThrow();
  });

  test("streamChat returns tool_use when tools are provided", async () => {
    const controller = new AbortController();
    const events: StreamEvent[] = [];

    // Ask something that should trigger a tool call
    const messages = [createUserMessage("请列出当前目录的文件，使用 Bash 工具执行 ls")];

    for await (const event of streamChat(messages, configWithTools, controller.signal)) {
      events.push(event);
    }

    // Verify we got content_block_start events
    const blockStarts = events.filter((e) => e.type === "content_block_start");
    expect(blockStarts.length).toBeGreaterThan(0);

    // Check for tool_use block
    const toolUseStart = blockStarts.find(
      (e) => (e as { content_block: { type: string } }).content_block.type === "tool_use",
    );
    expect(toolUseStart).toBeDefined();

    // Verify stop_reason is tool_use
    const messageDelta = events.find((e) => e.type === "message_delta");
    expect(messageDelta).toBeDefined();
    if (messageDelta && messageDelta.type === "message_delta") {
      expect(messageDelta.delta.stop_reason).toBe("tool_use");
    }

    console.log(`  Tool call events: ${blockStarts.length} blocks, stop_reason=tool_use`);
  }, 15000);
});
