import { describe, it, expect } from "vitest";
import { parseSkillManifest, SkillManifestError } from "../_skill-manifest.js";

const VALID_MD = `---
name: search
description: Web search & scraping
version: 1.2.0
tags: [web, scraping]
custom_field: foo
---

# Web Search Skill
`;

describe("parseSkillManifest", () => {
  it("parses valid frontmatter and splits known vs extras", () => {
    const r = parseSkillManifest(VALID_MD);
    expect(r.meta.name).toBe("search");
    expect(r.meta.description).toBe("Web search & scraping");
    expect(r.meta.version).toBe("1.2.0");
    expect(r.meta.tags).toEqual(["web", "scraping"]);
    expect(r.extras).toEqual({ custom_field: "foo" });
  });

  it("throws SkillManifestError when SKILL.md has no frontmatter", () => {
    expect(() => parseSkillManifest("# just a title\n")).toThrow(SkillManifestError);
  });

  it("throws SkillManifestError when name is missing", () => {
    expect(() => parseSkillManifest("---\ndescription: x\n---\nbody")).toThrow(/name/);
  });

  it("throws when name > 64 chars", () => {
    const long = "x".repeat(65);
    expect(() => parseSkillManifest(`---\nname: ${long}\n---\nbody`)).toThrow(/name/);
  });

  it("accepts manifest with only the required name field", () => {
    const r = parseSkillManifest("---\nname: minimal\n---\nbody");
    expect(r.meta.name).toBe("minimal");
    expect(r.extras).toEqual({});
  });
});
