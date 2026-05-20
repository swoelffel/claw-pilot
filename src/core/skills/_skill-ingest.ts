// src/core/skills/_skill-ingest.ts
//
// Unified ingest pipeline. The three entry points (blank, zip, github) all
// converge on parseAndValidateSkill(files[]) which returns the validated
// manifest and file list ready for skill-repository.createSkill().

import { unzip as fflateUnzip } from "fflate";
import { parseSkillManifest, SkillManifestError } from "./_skill-manifest.js";
import { SKILL_FILE_MAX_BYTES } from "../repositories/skill-repository.js";

export interface IngestedSkill {
  meta: {
    name: string;
    description?: string;
    version?: string;
    tags?: string[];
  };
  extras: Record<string, unknown>;
  files: Array<{ path: string; content: string }>;
}

// ---------------------------------------------------------------------- blank

export function ingestBlank(input: { name: string; description?: string }): IngestedSkill {
  const fmLines = [`name: ${input.name}`];
  if (input.description) fmLines.push(`description: ${input.description}`);
  const skillMd = `---\n${fmLines.join("\n")}\n---\n\n# ${input.name}\n`;
  return parseAndValidateSkill([{ path: "SKILL.md", content: skillMd }]);
}

// ------------------------------------------------------------------------ zip

export async function ingestZip(zipBuffer: Buffer): Promise<IngestedSkill> {
  const files = await extractZipEntries(zipBuffer);
  return parseAndValidateSkill(files);
}

async function extractZipEntries(
  zipBuffer: Buffer,
): Promise<Array<{ path: string; content: string }>> {
  return new Promise((resolve, reject) => {
    fflateUnzip(new Uint8Array(zipBuffer), (err, unzipped) => {
      if (err) {
        reject(new Error(`ZIP extraction failed: ${err.message}`));
        return;
      }
      const out: Array<{ path: string; content: string }> = [];
      for (const [name, data] of Object.entries(unzipped)) {
        if (name.endsWith("/")) continue;
        const content = Buffer.from(data).toString("utf8");
        out.push({ path: name, content });
      }
      resolve(stripTopLevelWrapper(out));
    });
  });
}

function stripTopLevelWrapper(
  files: Array<{ path: string; content: string }>,
): Array<{ path: string; content: string }> {
  if (files.length === 0) return files;
  const first = files[0];
  if (!first) return files;
  const firstSegment = first.path.split("/")[0];
  if (!firstSegment) return files;
  const allShareWrapper = files.every((f) => {
    const seg = f.path.split("/")[0];
    return seg === firstSegment && f.path.includes("/");
  });
  if (!allShareWrapper) return files;
  return files.map((f) => ({
    path: f.path.slice(firstSegment.length + 1),
    content: f.content,
  }));
}

// --------------------------------------------------------------------- github

export async function ingestGithub(input: {
  url: string;
  ref?: string;
  fetchFn?: typeof fetch;
}): Promise<IngestedSkill> {
  const parsed = parseGithubUrl(input.url);
  const ref = input.ref ?? parsed.ref ?? "HEAD";
  const tarballUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/zipball/${ref}`;
  const fetcher = input.fetchFn ?? fetch;
  const res = await fetcher(tarballUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`GitHub fetch failed: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return ingestZip(buf);
}

interface GithubRef {
  owner: string;
  repo: string;
  ref?: string;
}

function parseGithubUrl(url: string): GithubRef {
  // Accept "owner/repo", "owner/repo@ref", or full https://github.com/owner/repo[/tree/ref]
  const httpsMatch = /github\.com\/([^/]+)\/([^/]+?)(?:\/(?:tree|blob)\/([^/]+))?\/?$/.exec(url);
  if (httpsMatch) {
    const owner = httpsMatch[1] ?? "";
    const repo = (httpsMatch[2] ?? "").replace(/\.git$/, "");
    const ref = httpsMatch[3];
    return {
      owner,
      repo,
      ...(ref ? { ref } : {}),
    };
  }
  const shortMatch = /^([^/@]+)\/([^/@]+)(?:@(.+))?$/.exec(url);
  if (shortMatch) {
    const owner = shortMatch[1] ?? "";
    const repo = shortMatch[2] ?? "";
    const ref = shortMatch[3];
    return {
      owner,
      repo,
      ...(ref ? { ref } : {}),
    };
  }
  throw new Error(`Unrecognized GitHub reference: ${url}`);
}

// --------------------------------------------------------- shared validation

export function parseAndValidateSkill(
  files: Array<{ path: string; content: string }>,
): IngestedSkill {
  const skillMd = files.find((f) => f.path === "SKILL.md");
  if (!skillMd) {
    throw new SkillManifestError(
      "Skill bundle must contain SKILL.md at the root",
      "SKILL_MD_MISSING",
    );
  }

  for (const f of files) {
    const bytes = Buffer.byteLength(f.content, "utf8");
    if (bytes > SKILL_FILE_MAX_BYTES) {
      throw new Error(`File '${f.path}' is too large (${bytes} bytes > 1 MB cap)`);
    }
  }

  const parsed = parseSkillManifest(skillMd.content);
  return { meta: parsed.meta, extras: parsed.extras, files };
}
