import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  parseSSEStream,
  streamChat,
  type APIConfig,
  type StreamEvent,
} from "../../src/services/api.js";
import { createUserMessage } from "../../src/messages.js";

// Helper: create a mock SSE response from events
function createMockSSEResponse(events: object[]): Response {
  const encoder = new TextEncoder();
  const lines = events
    .map((e) => `data: ${JSON.stringify(e)}`)
    .join("\n\n");
  const body = `${lines}\n\ndata: [DONE]\n\n`;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });

  return {
    ok: true,
    body: stream,
    status: 200,
  } as Response;
}

// Helper: create a chunked SSE response (simulates real streaming)
function createChunkedSSEResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return {
    ok: true,
    body: stream,
    status: 200,
  } as Response;
}

describe("services/api", () => {
  describe("parseSSEStream", () => {
    test("parses complete SSE events", async () => {
      const events = [
        { type: "message_start", message: { id: "msg-1", model: "test" } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ];

      const response = createMockSSEResponse(events);
      const collected: StreamEvent[] = [];
      for await (const event of parseSSEStream(response)) {
        collected.push(event);
      }

      expect(collected).toHaveLength(6);
      expect(collected[0].type).toBe("message_start");
      expect(collected[2].type).toBe("content_block_delta");
    });

    test("parses chunked SSE events that split across chunks", async () => {
      const chunks = [
        "data: {\"type\": \"message_start\", \"message\": {\"id\": \"m1\"}}\n\nda",
        "ta: {\"type\": \"message_stop\"}\n\ndata: [DONE]\n\n",
      ];

      const response = createChunkedSSEResponse(chunks);
      const collected: StreamEvent[] = [];
      for await (const event of parseSSEStream(response)) {
        collected.push(event);
      }

      expect(collected).toHaveLength(2);
      expect(collected[0].type).toBe("message_start");
      expect(collected[1].type).toBe("message_stop");
    });

    test("skips non-data lines", async () => {
      const body = `event: message_start\ndata: {"type": "message_start", "message": {"id": "m1"}}\n\n: comment\ndata: {"type": "message_stop"}\n\ndata: [DONE]\n\n`;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(body));
          controller.close();
        },
      });
      const response = { ok: true, body: stream, status: 200 } as Response;

      const collected: StreamEvent[] = [];
      for await (const event of parseSSEStream(response)) {
        collected.push(event);
      }

      expect(collected).toHaveLength(2);
    });
  });

  describe("streamChat", () => {
    const mockConfig: APIConfig = {
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
      maxTokens: 1024,
      systemPrompt: "You are a helpful assistant.",
      temperature: 0,
    };

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    test("sends request with correct headers and body", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        createMockSSEResponse([{ type: "message_stop" }])
      );
      vi.stubGlobal("fetch", fetchSpy);

      const messages = [createUserMessage("Hello")];
      const controller = new AbortController();

      const collected: StreamEvent[] = [];
      for await (const _event of streamChat(messages, mockConfig, controller.signal)) {
        collected.push(_event);
      }

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(options.method).toBe("POST");
      expect(options.headers["x-api-key"]).toBe("test-key");
      expect(options.headers["anthropic-version"]).toBe("2023-06-01");

      const body = JSON.parse(options.body);
      expect(body.model).toBe("claude-sonnet-4-6");
      expect(body.max_tokens).toBe(1024);
      expect(body.stream).toBe(true);
    });

    test("yields stream events from API", async () => {
      const events = [
        { type: "message_start", message: { id: "msg-1" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } },
        { type: "message_stop" },
      ];
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createMockSSEResponse(events)));

      const messages = [createUserMessage("Hello")];
      const controller = new AbortController();

      const collected: StreamEvent[] = [];
      for await (const event of streamChat(messages, mockConfig, controller.signal)) {
        collected.push(event);
      }

      expect(collected).toHaveLength(3);
    });

    test("throws on non-ok response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          text: async () => '{"error": "invalid api key"}',
        })
      );

      const messages = [createUserMessage("Hello")];
      const controller = new AbortController();

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of streamChat(messages, mockConfig, controller.signal)) {
          // consume
        }
      }).rejects.toThrow(/401|Unauthorized/);
    });

    test("respects abort signal", async () => {
      const abortError = new DOMException("The operation was aborted", "AbortError");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(abortError)
      );

      const messages = [createUserMessage("Hello")];
      const controller = new AbortController();
      controller.abort();

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of streamChat(messages, mockConfig, controller.signal)) {
          // consume
        }
      }).rejects.toThrow(/aborted/i);
    });
  });
});
