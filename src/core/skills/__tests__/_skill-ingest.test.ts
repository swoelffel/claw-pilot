import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { ingestBlank, ingestZip, parseAndValidateSkill } from "../_skill-ingest.js";

describe("ingestBlank", () => {
  it("synthesizes a SKILL.md with frontmatter from the input name", () => {
    const r = ingestBlank({ name: "demo", description: "desc" });
    expect(r.meta.name).toBe("demo");
    expect(r.files.length).toBe(1);
    expect(r.files[0]?.path).toBe("SKILL.md");
    expect(r.files[0]?.content).toMatch(/^---\nname: demo\ndescription: desc\n---/);
  });
});

describe("parseAndValidateSkill", () => {
  it("accepts a tree containing SKILL.md at the root", () => {
    const files = [
      { path: "SKILL.md", content: "---\nname: ok\n---\nbody" },
      { path: "tools/x.ts", content: "export {}" },
    ];
    const r = parseAndValidateSkill(files);
    expect(r.meta.name).toBe("ok");
  });

  it("rejects a tree without SKILL.md", () => {
    expect(() => parseAndValidateSkill([{ path: "README.md", content: "x" }])).toThrow(/SKILL\.md/);
  });

  it("rejects a file exceeding 1 MB", () => {
    const big = "x".repeat(1_048_577);
    expect(() =>
      parseAndValidateSkill([
        { path: "SKILL.md", content: "---\nname: n\n---\n" },
        { path: "big.bin", content: big },
      ]),
    ).toThrow(/1 MB|too large/i);
  });
});

describe("ingestZip", () => {
  it("extracts a ZIP buffer into files[] and validates SKILL.md", async () => {
    const zipBuf = zipSync({
      "SKILL.md": strToU8("---\nname: zipped\n---\nbody"),
      "extra.txt": strToU8("hi"),
    });
    const r = await ingestZip(Buffer.from(zipBuf));
    expect(r.meta.name).toBe("zipped");
    expect(r.files.find((f) => f.path === "extra.txt")?.content).toBe("hi");
  });

  it("strips a top-level wrapping directory when present (GitHub tarball style)", async () => {
    const zipBuf = zipSync({
      "myskill-main/SKILL.md": strToU8("---\nname: wrapped\n---\n"),
      "myskill-main/tools/x.ts": strToU8("export {}"),
    });
    const r = await ingestZip(Buffer.from(zipBuf));
    expect(r.meta.name).toBe("wrapped");
    expect(r.files.map((f) => f.path).sort()).toEqual(["SKILL.md", "tools/x.ts"]);
  });
});
