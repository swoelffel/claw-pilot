// src/commands/_bracketed-paste.ts
//
// Bracketed paste mode parser for the `runtime chat` REPL.
// Terminals send \x1b[200~ before and \x1b[201~ after pasted text when
// bracketed paste mode is enabled (\x1b[?2004h).

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export interface PasteState {
  inPaste: boolean;
  buffer: string;
}

export interface PasteParseResult {
  /** True when a complete paste sequence has been assembled. */
  complete: boolean;
  /** The assembled paste text (only meaningful when complete=true). */
  text?: string;
  /** Updated parser state for the next chunk. */
  state: PasteState;
}

/**
 * Parse an incoming stdin chunk for bracketed paste sequences.
 * Call with the current parser state; returns the new state and, when
 * a complete paste has been detected, the assembled text.
 */
export function parseBracketedPaste(chunk: string, state: PasteState): PasteParseResult {
  let { inPaste, buffer } = state;
  let text = chunk;

  // Handle start marker
  if (!inPaste && text.includes(PASTE_START)) {
    inPaste = true;
    text = text.slice(text.indexOf(PASTE_START) + PASTE_START.length);
  }

  if (!inPaste) {
    // Not in a paste sequence — pass through unchanged
    return { complete: false, state: { inPaste: false, buffer: "" } };
  }

  // Handle end marker
  if (text.includes(PASTE_END)) {
    const endIdx = text.indexOf(PASTE_END);
    buffer += text.slice(0, endIdx);
    const assembled = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return {
      complete: true,
      text: assembled,
      state: { inPaste: false, buffer: "" },
    };
  }

  // Still accumulating
  buffer += text;
  return { complete: false, state: { inPaste: true, buffer } };
}
