/**
 * runtime/memory/__tests__/search-tool.test.ts
 *
 * Unit tests for the memory_search tool factory.
 * Tool.Info has { id, init() } — must call init() to get Definition.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemorySearchTool } from "../search-tool.js";

// Mock the searchMemory function
vi.mock("../index.js", () => ({
  searchMemory: vi.fn(),
}));

import { searchMemory } from "../index.js";

const mockSearchMemory = vi.mocked(searchMemory);

const fakeDb = {} as any;
const fakeCtx = {} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createMemorySearchTool", () => {
  it("returns a Tool.Info with correct id", () => {
    const tool = createMemorySearchTool(fakeDb);
    expect(tool.id).toBe("memory_search");
  });

  it("init() returns a definition with description", async () => {
    const tool = createMemorySearchTool(fakeDb);
    const def = await tool.init();
    expect(typeof def.description).toBe("string");
    expect(def.description).toContain("long-term memory");
  });

  it("init() returns a definition with parameters schema", async () => {
    const tool = createMemorySearchTool(fakeDb);
    const def = await tool.init();
    expect(def.parameters).toBeDefined();
  });

  it("execute returns formatted results", async () => {
    mockSearchMemory.mockReturnValue([
      { source: "memory/goals.md", chunk: "Ship v1.0 by March", rank: 1 },
      { source: "MEMORY.md", chunk: "Project uses SQLite", rank: 2 },
    ]);

    const tool = createMemorySearchTool(fakeDb);
    const def = await tool.init();
    const result = await def.execute({ query: "project goals" }, fakeCtx);

    expect(mockSearchMemory).toHaveBeenCalledWith(fakeDb, "project goals");
    expect(result.output).toContain("[1] Source: memory/goals.md");
    expect(result.output).toContain("[2] Source: MEMORY.md");
    expect(result.output).toContain("Ship v1.0 by March");
    expect(result.truncated).toBe(false);
  });

  it("execute returns no-results message when nothing matches", async () => {
    mockSearchMemory.mockReturnValue([]);

    const tool = createMemorySearchTool(fakeDb);
    const def = await tool.init();
    const result = await def.execute({ query: "nonexistent" }, fakeCtx);

    expect(result.output).toContain("No results found");
    expect(result.output).toContain("nonexistent");
  });

  it("execute includes query in the title when results are found", async () => {
    mockSearchMemory.mockReturnValue([{ source: "test.md", chunk: "test content", rank: 1 }]);

    const tool = createMemorySearchTool(fakeDb);
    const def = await tool.init();
    const result = await def.execute({ query: "architecture" }, fakeCtx);

    expect(result.title).toContain("architecture");
  });

  it("execute separates multiple results with dividers", async () => {
    mockSearchMemory.mockReturnValue([
      { source: "a.md", chunk: "chunk A", rank: 1 },
      { source: "b.md", chunk: "chunk B", rank: 2 },
    ]);

    const tool = createMemorySearchTool(fakeDb);
    const def = await tool.init();
    const result = await def.execute({ query: "test" }, fakeCtx);

    expect(result.output).toContain("---");
  });
});
