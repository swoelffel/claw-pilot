/**
 * runtime/channel/whatsapp/formatter.ts
 *
 * Converts standard Markdown to WhatsApp formatting.
 *
 * WhatsApp formatting rules:
 * - Bold: *text*
 * - Italic: _text_
 * - Strikethrough: ~text~
 * - Monospace: ```text```
 * - Inline code: `code` (rendered as monospace on most clients)
 *
 * Strategy: simple best-effort conversion — handles the most common Markdown
 * patterns. No special escaping needed (WhatsApp is more forgiving than Telegram).
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a Markdown string to WhatsApp formatting.
 *
 * Handles:
 * - Fenced code blocks (``` ... ```)
 * - Inline code (`code`)
 * - Bold (**text**)
 * - Italic (*text* or _text_)
 * - Strikethrough (~~text~~)
 * - Headers (# H1 → *H1*)
 * - Unordered lists (- item → - item)
 * - Ordered lists (1. item → 1. item)
 * - Horizontal rules (--- → stripped)
 * - Plain text (passthrough)
 */
export function markdownToWhatsApp(markdown: string): string {
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
        // WhatsApp renders triple-backtick blocks as monospace
        const langHint = codeBlockLang ? `${codeBlockLang}\n` : "";
        output.push(`\`\`\`${langHint}${code}\`\`\``);
        codeBlockLang = "";
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    output.push(convertLine(line));
  }

  // Unclosed code block — flush as plain text
  if (inCodeBlock && codeBlockLines.length > 0) {
    output.push(codeBlockLines.join("\n"));
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
    return `*${headerMatch[1]}*`;
  }

  // Blockquote: > text → > text (keep as-is)
  const bqMatch = line.match(/^>\s*(.*)$/);
  if (bqMatch) {
    return `> ${convertInline(bqMatch[1] ?? "")}`;
  }

  return convertInline(line);
}

/**
 * Convert inline Markdown formatting within a single line.
 * Processes: inline code, bold, italic, strikethrough.
 */
function convertInline(text: string): string {
  let result = "";
  let i = 0;

  while (i < text.length) {
    // Inline code: `code`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        const code = text.slice(i + 1, end);
        result += `\`${code}\``;
        i = end + 1;
        continue;
      }
    }

    // Bold: **text**
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        const inner = text.slice(i + 2, end);
        result += `*${inner}*`;
        i = end + 2;
        continue;
      }
    }

    // Strikethrough: ~~text~~
    if (text.startsWith("~~", i)) {
      const end = text.indexOf("~~", i + 2);
      if (end !== -1) {
        const inner = text.slice(i + 2, end);
        result += `~${inner}~`;
        i = end + 2;
        continue;
      }
    }

    // Italic: *text* (single asterisk, not double)
    if (text[i] === "*" && text[i + 1] !== "*") {
      const end = text.indexOf("*", i + 1);
      if (end !== -1 && text[end + 1] !== "*") {
        const inner = text.slice(i + 1, end);
        result += `_${inner}_`;
        i = end + 1;
        continue;
      }
    }

    // Italic: _text_ (single underscore)
    if (text[i] === "_" && text[i + 1] !== "_") {
      const end = text.indexOf("_", i + 1);
      if (end !== -1 && text[end + 1] !== "_") {
        const inner = text.slice(i + 1, end);
        result += `_${inner}_`;
        i = end + 1;
        continue;
      }
    }

    // Plain character — passthrough
    result += text[i];
    i++;
  }

  return result;
}
