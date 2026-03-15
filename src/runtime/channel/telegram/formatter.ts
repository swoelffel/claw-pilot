/**
 * runtime/channel/telegram/formatter.ts
 *
 * Converts plain Markdown to Telegram MarkdownV2 format.
 *
 * Telegram MarkdownV2 rules:
 * - Escape these chars outside formatting: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * - Bold: *text*
 * - Italic: _text_
 * - Code: `code`
 * - Code block: ```lang\ncode\n```
 * - Strikethrough: ~text~
 * - Underline: __text__
 *
 * Strategy: simple best-effort conversion — handles the most common Markdown
 * patterns. Complex nested formatting is flattened to plain text.
 */

// Characters that must be escaped in MarkdownV2 plain text
const ESCAPE_CHARS = /([_*[\]()~`>#+\-=|{}.!\\])/g;

/**
 * Escape a plain text string for use in Telegram MarkdownV2.
 */
export function escapeTelegramV2(text: string): string {
  return text.replace(ESCAPE_CHARS, "\\$1");
}

/**
 * Convert a Markdown string to Telegram MarkdownV2.
 *
 * Handles:
 * - Fenced code blocks (``` ... ```)
 * - Inline code (`code`)
 * - Bold (**text** or __text__)
 * - Italic (*text* or _text_)
 * - Headers (# H1 → *H1*)
 * - Unordered lists (- item → • item)
 * - Ordered lists (1. item → 1\. item)
 * - Horizontal rules (--- → stripped)
 * - Plain text (escaped)
 */
export function markdownToTelegramV2(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  for (const line of lines) {
    // Fenced code block start/end
    const fenceMatch = line.match(/^```(\w*)$/);
    if (fenceMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = fenceMatch[1] ?? "";
        codeBlockLines = [];
      } else {
        // End of code block
        inCodeBlock = false;
        const code = codeBlockLines.join("\n");
        // Escape backticks inside code block
        const escaped = code.replace(/`/g, "\\`");
        output.push(`\`\`\`${codeBlockLang}\n${escaped}\n\`\`\``);
        codeBlockLang = "";
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Process inline formatting on the line
    output.push(convertLine(line));
  }

  // Unclosed code block — flush as plain text
  if (inCodeBlock && codeBlockLines.length > 0) {
    output.push(escapeTelegramV2(codeBlockLines.join("\n")));
  }

  return output.join("\n");
}

// ---------------------------------------------------------------------------
// Line-level conversion
// ---------------------------------------------------------------------------

function convertLine(line: string): string {
  // Horizontal rule
  if (/^[-*_]{3,}$/.test(line.trim())) {
    return "";
  }

  // Headers: # H1 → *H1*
  const headerMatch = line.match(/^#{1,6}\s+(.+)$/);
  if (headerMatch) {
    const text = headerMatch[1] ?? "";
    return `*${escapeTelegramV2(text)}*`;
  }

  // Unordered list: - item or * item → • item
  const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
  if (ulMatch) {
    const indent = ulMatch[1] ?? "";
    const text = ulMatch[2] ?? "";
    return `${indent}• ${convertInline(text)}`;
  }

  // Ordered list: 1. item → 1\. item
  const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
  if (olMatch) {
    const indent = olMatch[1] ?? "";
    const num = olMatch[2] ?? "1";
    const text = olMatch[3] ?? "";
    return `${indent}${escapeTelegramV2(num + ".")} ${convertInline(text)}`;
  }

  // Blockquote: > text → > text (keep as-is, escape content)
  const bqMatch = line.match(/^>\s*(.*)$/);
  if (bqMatch) {
    return `>${convertInline(bqMatch[1] ?? "")}`;
  }

  return convertInline(line);
}

/**
 * Convert inline Markdown formatting within a single line.
 * Processes: inline code, bold, italic.
 */
function convertInline(text: string): string {
  // We process token by token to avoid double-escaping
  let result = "";
  let i = 0;

  while (i < text.length) {
    // Inline code: `code`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        const code = text.slice(i + 1, end).replace(/`/g, "\\`");
        result += `\`${code}\``;
        i = end + 1;
        continue;
      }
    }

    // Bold: **text** or __text__
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        const inner = escapeTelegramV2(text.slice(i + 2, end));
        result += `*${inner}*`;
        i = end + 2;
        continue;
      }
    }

    // Italic: *text* (single asterisk, not double)
    if (text[i] === "*" && text[i + 1] !== "*") {
      const end = text.indexOf("*", i + 1);
      if (end !== -1 && text[end + 1] !== "*") {
        const inner = escapeTelegramV2(text.slice(i + 1, end));
        result += `_${inner}_`;
        i = end + 1;
        continue;
      }
    }

    // Italic: _text_ (single underscore)
    if (text[i] === "_" && text[i + 1] !== "_") {
      const end = text.indexOf("_", i + 1);
      if (end !== -1 && text[end + 1] !== "_") {
        const inner = escapeTelegramV2(text.slice(i + 1, end));
        result += `_${inner}_`;
        i = end + 1;
        continue;
      }
    }

    // Strikethrough: ~~text~~
    if (text.startsWith("~~", i)) {
      const end = text.indexOf("~~", i + 2);
      if (end !== -1) {
        const inner = escapeTelegramV2(text.slice(i + 2, end));
        result += `~${inner}~`;
        i = end + 2;
        continue;
      }
    }

    // Plain character — escape it
    result += escapeTelegramV2(text[i]!);
    i++;
  }

  return result;
}
