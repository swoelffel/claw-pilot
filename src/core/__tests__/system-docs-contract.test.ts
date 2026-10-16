import { afterEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { initDatabase } from "../../db/schema.js";
import { parseAndValidateTeam } from "../team-import.js";
import { createWorkspaceKnowledgeTools } from "../../runtime/plugin/workspace-knowledge/tools.js";
import type { Tool } from "../../runtime/tool/tool.js";
import type Database from "better-sqlite3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workspace = path.join(root, "templates/system/workspace");

function loadDocuments(): Map<string, string> {
  const documents = new Map<string, string>();
  function scan(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (entry.name.endsWith(".md")) {
        documents.set(
          path.relative(workspace, full).split(path.sep).join("/"),
          readFileSync(full, "utf8"),
        );
      }
    }
  }
  scan(workspace);
  const parsed = parseAndValidateTeam(
    readFileSync(path.join(root, "templates/system/cp-system.team.yaml"), "utf8"),
  );
  if (!parsed.success) throw new Error("Invalid system team template");
  for (const agent of parsed.data.agents) {
    for (const [name, body] of Object.entries(agent.files ?? {})) {
      documents.set(`${agent.id}/${name}`, body);
    }
  }
  return documents;
}

// This is a document boundary check, not a prose snapshot. Removing a promised
// knowledge file or documenting a nonexistent tool must fail publication.
function referenceErrors(documents: Map<string, string>, toolNames: Set<string>): string[] {
  const errors: string[] = [];
  for (const [source, body] of documents) {
    const agent = source.split("/")[0]!;
    const targets = [...body.matchAll(/`((?:@shared\/docs|docs)\/[\w/.-]+)`/g)].map((m) =>
      m[1]!.startsWith("@shared/") ? m[1]!.slice(1) : `${agent}/${m[1]}`,
    );
    for (const match of body.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      const target = match[1]!;
      if (!target.includes("://"))
        targets.push(path.posix.normalize(path.posix.join(path.posix.dirname(source), target)));
    }
    for (const target of targets) {
      if (
        !documents.has(target) &&
        ![...documents.keys()].some((name) => name.startsWith(target.replace(/\/$/, "") + "/"))
      ) {
        errors.push(`${source}: missing ${target}`);
      }
    }
    for (const match of body.matchAll(/\bcp_[a-z][a-z_]+\b/g)) {
      if (!toolNames.has(match[0])) errors.push(`${source}: unknown tool ${match[0]}`);
    }
    if (/delegate to[^\n]*db-analyst/i.test(body)) errors.push(`${source}: obsolete delegate`);
  }
  return [...new Set(errors)];
}

let db: Database.Database | undefined;
afterEach(() => db?.close());

describe("packaged system knowledge", () => {
  it("resolves promised knowledge paths and tool names for the current team", () => {
    const tools = readFileSync(path.join(root, "src/runtime/plugin/system-tools/tools.ts"), "utf8");
    const names = new Set([...tools.matchAll(/Tool\.define\("(cp_[a-z_]+)"/g)].map((m) => m[1]!));
    expect(referenceErrors(loadDocuments(), names)).toEqual([]);
  });

  it("detects a missing shared target, unknown tool and stale delegate in a fixture", () => {
    const documents = new Map([
      [
        "ops/SOUL.md",
        "Read `@shared/docs/missing.md`, use cp_unknown_tool. Delegate to db-analyst.",
      ],
    ]);
    expect(referenceErrors(documents, new Set())).toEqual([
      "ops/SOUL.md: missing shared/docs/missing.md",
      "ops/SOUL.md: unknown tool cp_unknown_tool",
      "ops/SOUL.md: obsolete delegate",
    ]);
  });

  it("finds operational guides through real agent-scoped workspace discovery and FTS", async () => {
    db = initDatabase(":memory:");
    const server = db
      .prepare("INSERT INTO servers (hostname, openclaw_home) VALUES ('docs-test','/unused')")
      .run().lastInsertRowid;
    const instance = db
      .prepare(
        "INSERT INTO instances (server_id,slug,port,state,config_path,state_dir,systemd_unit) VALUES (?,'cp-system',19000,'stopped','/unused','/unused','docs-test.service')",
      )
      .run(server).lastInsertRowid;
    const documents = loadDocuments();
    for (const agent of ["system-pilot", "ops", "analyst"]) {
      const id = db
        .prepare(
          "INSERT INTO agents (instance_id,agent_id,name,model,workspace_path) VALUES (?,?,?,'test/model','/unused')",
        )
        .run(instance, agent, agent).lastInsertRowid;
      for (const [name, content] of documents) {
        if (name.startsWith(`${agent}/`))
          db.prepare(
            "INSERT INTO agent_files (agent_id,filename,content,content_hash) VALUES (?,?,?,'test')",
          ).run(id, name.slice(agent.length + 1), content);
      }
    }
    for (const [name, content] of documents) {
      if (name.startsWith("shared/"))
        db.prepare(
          "INSERT INTO instance_shared_files (instance_id,filename,content,content_hash) VALUES (?,?,?,'test')",
        ).run(instance, name.slice(7), content);
    }
    async function run(
      agent: string,
      toolId: string,
      args: Record<string, string>,
    ): Promise<string> {
      const tools = createWorkspaceKnowledgeTools(db!, "cp-system", undefined, agent);
      const tool = await tools.find((t) => t.id === toolId)!.init();
      return (await tool.execute(args, { agentId: agent } as Tool.Context)).output;
    }
    for (const agent of ["system-pilot", "ops", "analyst"]) {
      expect(await run(agent, "ws_list_files", { dir: "@shared/docs/reference" })).toContain(
        "@shared/docs/reference/system-tools.md",
      );
      expect(
        await run(agent, "ws_search_files", {
          query: '"canonical"',
          dir: "@shared/docs/reference",
        }),
      ).toContain("@shared/docs/reference/data-sources.md");
    }
    for (const [query, expected] of [
      ['"revocation"', "docs/flows/webhooks.md"],
      ['"expired"', "docs/monitoring/recovery-and-timeouts.md"],
      ['"workflow"', "docs/flows/governance.md"],
    ]) {
      expect(
        await run("system-pilot", "ws_search_files", {
          query: query!,
          dir: expected!.startsWith("docs/flows/") ? "docs/flows" : "docs/monitoring",
        }),
      ).toContain(expected);
    }
  });
});
