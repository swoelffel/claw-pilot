/**
 * runtime/channel/__tests__/telegram-formatter.test.ts
 *
 * Unit tests for the Telegram MarkdownV2 formatter.
 * Covers escapeTelegramV2 and markdownToTelegramV2 (including internal
 * convertLine and convertInline logic).
 */

import { describe, it, expect } from "vitest";
import { escapeTelegramV2, markdownToTelegramV2 } from "../telegram/formatter.js";

// ---------------------------------------------------------------------------
// escapeTelegramV2
// ---------------------------------------------------------------------------

describe("escapeTelegramV2", () => {
  it("escapes special characters", () => {
    const input =
      "Hello_world *bold* [link](url) ~strike~ `code` >quote #tag +plus -minus =eq |pipe {brace} .dot !bang";
    const result = escapeTelegramV2(input);
    // Every special char should be backslash-escaped
    expect(result).toContain("\\_");
    expect(result).toContain("\\*");
    expect(result).toContain("\\[");
    expect(result).toContain("\\]");
    expect(result).toContain("\\(");
    expect(result).toContain("\\)");
    expect(result).toContain("\\~");
    expect(result).toContain("\\`");
    expect(result).toContain("\\>");
    expect(result).toContain("\\#");
    expect(result).toContain("\\+");
    expect(result).toContain("\\-");
    expect(result).toContain("\\=");
    expect(result).toContain("\\|");
    expect(result).toContain("\\{");
    expect(result).toContain("\\}");
    expect(result).toContain("\\.");
    expect(result).toContain("\\!");
  });

  it("leaves alphanumeric text unchanged", () => {
    expect(escapeTelegramV2("Hello World 123")).toBe("Hello World 123");
  });
});

// ---------------------------------------------------------------------------
// markdownToTelegramV2
// ---------------------------------------------------------------------------

describe("markdownToTelegramV2", () => {
  it("converts headers to bold", () => {
    expect(markdownToTelegramV2("# Title")).toBe("*Title*");
    expect(markdownToTelegramV2("## Subtitle")).toBe("*Subtitle*");
    expect(markdownToTelegramV2("### Deep")).toBe("*Deep*");
  });

  it("converts fenced code blocks and escapes inner backticks", () => {
    const md = "```js\nconst x = `hello`;\n```";
    const result = markdownToTelegramV2(md);
    // Should produce a MarkdownV2 code block with escaped backticks inside
    // Inside code blocks only backticks are escaped (not = or ;)
    expect(result).toBe("```js\nconst x = \\`hello\\`;\n```");
  });

  it("converts inline code", () => {
    const result = markdownToTelegramV2("Use `npm install` to install");
    expect(result).toContain("`npm install`");
    // Text outside backticks should be escaped
    expect(result).toContain("to install");
  });

  it("converts bold (**text** to *text*)", () => {
    const result = markdownToTelegramV2("This is **important** stuff");
    expect(result).toContain("*important*");
    // Should not contain double asterisks
    expect(result).not.toContain("**");
  });

  it("converts italic (*text* to _text_)", () => {
    const result = markdownToTelegramV2("This is *emphasis* here");
    expect(result).toContain("_emphasis_");
  });

  it("converts strikethrough (~~text~~ to ~text~)", () => {
    const result = markdownToTelegramV2("This is ~~deleted~~ text");
    expect(result).toContain("~deleted~");
    // Should not contain double tildes
    expect(result).not.toContain("~~");
  });

  it("converts unordered lists (- item to bullet)", () => {
    const result = markdownToTelegramV2("- first item\n- second item");
    expect(result).toContain("• first item");
    expect(result).toContain("• second item");
  });

  it("converts ordered lists (1. item to 1\\. item)", () => {
    const result = markdownToTelegramV2("1. first\n2. second");
    expect(result).toContain("1\\.");
    expect(result).toContain("2\\.");
    expect(result).toContain("first");
    expect(result).toContain("second");
  });

  it("strips horizontal rules", () => {
    const result = markdownToTelegramV2("above\n---\nbelow");
    // The HR line should become empty string
    expect(result).toBe("above\n\nbelow");
  });

  it("handles blockquotes", () => {
    const result = markdownToTelegramV2("> quoted text");
    // Blockquote: >content (no space after >)
    expect(result.startsWith(">")).toBe(true);
    expect(result).toContain("quoted text");
  });

  it("escapes plain text", () => {
    const result = markdownToTelegramV2("Price is $10.00!");
    expect(result).toContain("\\.");
    expect(result).toContain("\\!");
  });

  it("handles unclosed code block gracefully", () => {
    const md = "```\nsome code\nmore code";
    const result = markdownToTelegramV2(md);
    // Unclosed block flushes as escaped plain text
    expect(result).toContain("some code");
    expect(result).toContain("more code");
    // Should not throw
  });

  it("handles mixed formatting in one line", () => {
    const result = markdownToTelegramV2("Use **bold** and *italic* together");
    // Bold converted to *...*
    expect(result).toContain("*bold*");
    // Italic converted to _..._
    expect(result).toContain("_italic_");
  });
});
