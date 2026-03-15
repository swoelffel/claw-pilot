/**
 * runtime/memory/search-tool.ts
 *
 * memory_search tool — full-text search over the agent's long-term memory.
 *
 * Uses the FTS5 index built by memory/index.ts to return the most relevant
 * excerpts from MEMORY.md and memory/*.md files.
 *
 * This tool is created via a factory (createMemorySearchTool) that captures
 * the memory index DB in a closure. It is injected into the tool set by the
 * prompt loop when a memory index is available.
 */

import { z } from "zod";
import type Database from "better-sqlite3";
import { Tool } from "../tool/tool.js";
import { searchMemory } from "./index.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the memory_search tool with access to the memory index DB.
 *
 * @param memoryDb - The open FTS5 memory index database (from openMemoryIndex())
 * @returns A Tool.Info that can be added to the tool set
 */
export function createMemorySearchTool(memoryDb: Database.Database): Tool.Info {
  return Tool.define("memory_search", {
    description:
      "Search the agent's long-term memory (MEMORY.md and memory/*.md files) " +
      "using full-text search. Returns the most relevant excerpts for the query. " +
      "Use this instead of reading MEMORY.md in full when looking for specific information " +
      "such as past decisions, key files, or ongoing tasks.",
    parameters: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          "Search query — keywords or a short phrase. " +
            "Examples: 'architecture decision', 'sprint tasks', 'API key setup'",
        ),
    }),
    async execute({ query }) {
      const results = searchMemory(memoryDb, query);

      if (results.length === 0) {
        return {
          title: "memory_search",
          output: `No results found for query: "${query}"`,
          truncated: false,
        };
      }

      const output = results
        .map((r, i) => `[${i + 1}] Source: ${r.source}\n${r.chunk}`)
        .join("\n\n---\n\n");

      return {
        title: `memory_search: ${query}`,
        output,
        truncated: false,
      };
    },
  });
}
