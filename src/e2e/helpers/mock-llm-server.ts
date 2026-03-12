// src/e2e/helpers/mock-llm-server.ts
// Minimal HTTP server that simulates the Anthropic streaming API for e2e tests.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockLlmServer {
  baseUrl: string;
  cleanup: () => void;
}

/**
 * Start a mock Anthropic-compatible streaming server.
 * Responds to POST /v1/messages with a minimal SSE stream.
 */
export async function startMockLlmServer(
  response = "Hello from mock LLM!",
): Promise<MockLlmServer> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/messages") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        // Minimal Anthropic streaming response format
        const events = [
          {
            type: "message_start",
            message: {
              id: "msg_test",
              type: "message",
              role: "assistant",
              content: [],
              model: "claude-3-5-haiku-20241022",
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: response },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 5 },
          },
          { type: "message_stop" },
        ];

        for (const event of events) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        cleanup: () => server.close(),
      });
    });
  });
}
