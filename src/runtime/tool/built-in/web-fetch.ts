/**
 * runtime/tool/built-in/web-fetch.ts
 *
 * WebFetch tool — fetches content from a URL and returns it as text or markdown.
 * Uses Node.js native fetch (available since Node 18).
 */

import { z } from "zod";
import { Tool } from "../tool.js";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5 MB
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export const WebFetchTool = Tool.define("webfetch", {
  description:
    "Fetches content from a specified URL. " +
    "Takes a URL and optional format as input. " +
    "Fetches the URL content, converts to requested format (markdown by default). " +
    "Returns the content in the specified format.",
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .default("markdown")
      .describe(
        "The format to return the content in (text, markdown, or html). Defaults to markdown.",
      ),
    timeout: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional timeout in seconds (max 120)"),
  }),
  async execute(params, ctx) {
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://");
    }

    const timeoutMs = Math.min(
      (params.timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000,
      MAX_TIMEOUT_MS,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Combine with caller's abort signal
    const abortHandler = () => controller.abort();
    ctx.abort.addEventListener("abort", abortHandler, { once: true });

    let response: Response;
    try {
      response = await fetch(params.url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
          Accept: buildAcceptHeader(params.format),
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } finally {
      clearTimeout(timer);
      ctx.abort.removeEventListener("abort", abortHandler);
    }

    if (!response.ok) {
      throw new Error(`Request failed with status code: ${response.status}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)");
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)");
    }

    const contentType = response.headers.get("content-type") ?? "";
    const content = new TextDecoder().decode(buffer);
    const title = `${params.url} (${contentType})`;

    let output: string;
    if (params.format === "markdown" && contentType.includes("text/html")) {
      output = htmlToMarkdown(content);
    } else if (params.format === "text" && contentType.includes("text/html")) {
      output = htmlToText(content);
    } else {
      output = content;
    }

    return { title, output, truncated: false };
  },
});

function buildAcceptHeader(format: "text" | "markdown" | "html"): string {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1";
  }
}

/** Very simple HTML → plain text (strip tags) */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Very simple HTML → markdown (headings, links, code blocks) */
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => {
      return "\n" + "#".repeat(parseInt(level)) + " " + stripTags(text) + "\n";
    })
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      return `[${stripTags(text)}](${href})`;
    })
    .replace(/<code>([\s\S]*?)<\/code>/gi, (_, code) => "`" + code + "`")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => "```\n" + stripTags(code) + "\n```")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => "- " + stripTags(text))
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => "\n" + stripTags(text) + "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}
