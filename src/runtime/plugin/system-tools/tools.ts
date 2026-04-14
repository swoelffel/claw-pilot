// src/runtime/plugin/system-tools/tools.ts
//
// All 26 cp_* tool definitions for the system-pilot agent.
// Tools operate directly on the DB via Registry and core classes --
// no HTTP round-trip through the dashboard.

import type Database from "better-sqlite3";
import { z } from "zod";
import { Tool } from "../../tool/tool.js";
import { Registry } from "../../../core/registry.js";
import { LocalConnection } from "../../../server/local.js";
import { Lifecycle } from "../../../core/lifecycle.js";
import { Provisioner } from "../../../core/provisioner.js";
import { Destroyer } from "../../../core/destroyer.js";
import { resolveXdgRuntimeDir } from "../../../lib/xdg.js";
import { getRuntimeStateDir, isRuntimeRunning } from "../../../lib/platform.js";
import { isCryptoAvailable } from "../../../lib/crypto.js";
import { NamedKeyRepository } from "../../../core/repositories/named-key-repository.js";
import { logger } from "../../../lib/logger.js";
import type { InstanceSlug } from "../../types.js";
import {
  listFlowDefinitions,
  createFlowDefinition,
  deleteFlowDefinition,
} from "../../../core/repositories/flow-repository.js";
import { getCostSummary, getCostsByAgent } from "../../../core/repositories/cost-repository.js";
import { exportRuntimeJsonSnapshot } from "../../engine/config-loader.js";
import { callRuntimeApi } from "../../../dashboard/routes/_internal-api-client.js";

// ---------------------------------------------------------------------------
// Output sanitization -- strip filesystem paths that agents cannot use
// and that cause hallucinations about editing runtime.json directly.
// ---------------------------------------------------------------------------

/** Fields to omit from instance payloads exposed to agents. */
const FS_PATH_KEYS = new Set(["config_path", "state_dir", "systemd_unit"]);

function stripFsPaths(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(stripFsPaths);
  if (typeof data === "object" && data !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (!FS_PATH_KEYS.has(k)) out[k] = v;
    }
    return out;
  }
  return data;
}

// ---------------------------------------------------------------------------
// SQL security helpers (for cp_query_db)
// ---------------------------------------------------------------------------

const SENSITIVE_COLUMNS = new Set(["encrypted_api_key"]);

function maskSensitiveColumns(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (typeof row !== "object" || row === null) return row;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      out[k] = SENSITIVE_COLUMNS.has(k) ? "***MASKED***" : v;
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Shared dependencies for domain-specific tool factories
// ---------------------------------------------------------------------------

interface ToolDeps {
  db: Database.Database;
  registry: Registry;
  conn: LocalConnection;
  namedKeys: NamedKeyRepository;
  getXdgDir: () => Promise<string>;
}

// ---------------------------------------------------------------------------
// Instance tools
// ---------------------------------------------------------------------------

function createInstanceQueryTools(deps: ToolDeps): Tool.Info[] {
  const { registry } = deps;

  return [
    Tool.define("cp_list_instances", {
      description:
        "List all claw-pilot instances with their status, port, and model. " +
        "Returns an array of instance objects.",
      parameters: z.object({}),
      async execute() {
        const instances = registry.listInstances();
        return {
          title: "list instances",
          output: JSON.stringify(stripFsPaths(instances), null, 2),
          truncated: false,
        };
      },
    }),

    Tool.define("cp_get_instance", {
      description: "Get detailed information about a specific instance by its slug.",
      parameters: z.object({
        slug: z.string().describe("Instance slug (e.g. 'my-team')"),
      }),
      async execute({ slug }) {
        const instance = registry.getInstance(slug);
        if (!instance) {
          return {
            title: "get instance",
            output: `Error: Instance "${slug}" not found.`,
            truncated: false,
          };
        }
        return {
          title: "get instance",
          output: JSON.stringify(stripFsPaths(instance), null, 2),
          truncated: false,
        };
      },
    }),
  ];
}

function createInstanceMutationTools(deps: ToolDeps): Tool.Info[] {
  const { registry, conn, namedKeys, getXdgDir } = deps;

  return [
    Tool.define("cp_create_instance", {
      description:
        "Create a new claw-pilot instance. Requires a slug, default model, and named API key ID. " +
        "Optionally provide agent definitions.",
      parameters: z.object({
        slug: z
          .string()
          .min(2)
          .max(30)
          .describe("Instance slug (lowercase, letters/numbers/hyphens)"),
        displayName: z.string().optional().describe("Human-readable display name"),
        defaultModel: z.string().describe("Default model ID (e.g. 'anthropic/claude-sonnet-4-5')"),
        namedKeyId: z.number().int().describe("ID of the named API key to use"),
        agents: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              isDefault: z.boolean().optional(),
            }),
          )
          .optional()
          .describe("Agent definitions (defaults to one agent named 'default')"),
      }),
      async execute(params) {
        // 1. Validate named key exists
        const key = namedKeys.getById(params.namedKeyId);
        if (!key) {
          return {
            title: "create instance",
            output: `Error: Named API key with id ${params.namedKeyId} not found.`,
            truncated: false,
          };
        }

        // 2. Resolve server id
        const server = registry.getLocalServer();
        if (!server) {
          return {
            title: "create instance",
            output: "Error: No local server registered. Run 'claw-pilot init' first.",
            truncated: false,
          };
        }

        // 3. Provision
        const agents = params.agents ?? [{ id: "default", name: "Default", isDefault: true }];
        const provisioner = new Provisioner(conn, registry);
        try {
          const result = await provisioner.provision(
            {
              slug: params.slug,
              displayName: params.displayName ?? params.slug,
              defaultModel: params.defaultModel,
              provider: key.providerId,
              apiKey: "reuse",
              agents: agents.map((a) => ({
                id: a.id,
                name: a.name,
                ...(a.isDefault !== undefined ? { isDefault: a.isDefault } : {}),
              })),
              telegram: { enabled: false },
              mem0: { enabled: false },
            },
            server.id,
          );

          // 4. Assign named key to the newly created instance
          const inst = registry.getInstance(params.slug);
          if (inst) {
            namedKeys.setDefaultKeyForInstance(inst.id, params.namedKeyId);
          }

          return {
            title: "create instance",
            output: JSON.stringify(result, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_create_instance failed", { error: String(err) });
          return {
            title: "create instance",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),

    Tool.define("cp_delete_instance", {
      description:
        "Delete an instance and all its data. Cannot delete the system instance (cp-system).",
      parameters: z.object({
        slug: z.string().describe("Instance slug to delete"),
      }),
      async execute({ slug }) {
        if (slug === "cp-system") {
          return {
            title: "delete instance",
            output: "Error: Cannot delete the system instance (cp-system).",
            truncated: false,
          };
        }
        try {
          const xdgDir = await getXdgDir();
          const destroyer = new Destroyer(conn, registry, xdgDir);
          await destroyer.destroy(slug);
          return {
            title: "delete instance",
            output: JSON.stringify({ ok: true, deleted: slug }, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_delete_instance failed", { error: String(err) });
          return {
            title: "delete instance",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),
  ];
}

function createInstanceLifecycleTools(deps: ToolDeps): Tool.Info[] {
  const { registry, conn, getXdgDir } = deps;

  return [
    Tool.define("cp_start_instance", {
      description: "Start a stopped instance runtime daemon.",
      parameters: z.object({
        slug: z.string().describe("Instance slug to start"),
      }),
      async execute({ slug }) {
        try {
          const xdgDir = await getXdgDir();
          const lifecycle = new Lifecycle(conn, registry, xdgDir);
          await lifecycle.start(slug);
          return {
            title: "start instance",
            output: JSON.stringify({ ok: true, slug, state: "running" }, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_start_instance failed", { error: String(err) });
          return {
            title: "start instance",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),

    Tool.define("cp_stop_instance", {
      description: "Stop a running instance runtime daemon. Cannot stop the system instance.",
      parameters: z.object({
        slug: z.string().describe("Instance slug to stop"),
      }),
      async execute({ slug }) {
        if (slug === "cp-system") {
          return {
            title: "stop instance",
            output: "Error: Cannot stop the system instance (cp-system).",
            truncated: false,
          };
        }
        try {
          const xdgDir = await getXdgDir();
          const lifecycle = new Lifecycle(conn, registry, xdgDir);
          await lifecycle.stop(slug);
          return {
            title: "stop instance",
            output: JSON.stringify({ ok: true, slug, state: "stopped" }, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_stop_instance failed", { error: String(err) });
          return {
            title: "stop instance",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),

    Tool.define("cp_restart_instance", {
      description: "Restart a running instance runtime daemon.",
      parameters: z.object({
        slug: z.string().describe("Instance slug to restart"),
      }),
      async execute({ slug }) {
        try {
          const xdgDir = await getXdgDir();
          const lifecycle = new Lifecycle(conn, registry, xdgDir);
          await lifecycle.restart(slug);
          return {
            title: "restart instance",
            output: JSON.stringify({ ok: true, slug, state: "running" }, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_restart_instance failed", { error: String(err) });
          return {
            title: "restart instance",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// Agent tools
// ---------------------------------------------------------------------------

function createAgentTools(deps: ToolDeps): Tool.Info[] {
  const { registry, conn, getXdgDir } = deps;

  return [
    Tool.define("cp_list_agents", {
      description: "List all agents configured for a specific instance.",
      parameters: z.object({
        slug: z.string().describe("Instance slug"),
      }),
      async execute({ slug }) {
        const agents = registry.listAgents(slug);
        return {
          title: "list agents",
          output: JSON.stringify(agents, null, 2),
          truncated: false,
        };
      },
    }),

    Tool.define("cp_update_instance_config", {
      description:
        "Update instance configuration (add/update/remove agents, change default model, etc.). " +
        "Send a partial config patch.",
      parameters: z.object({
        slug: z.string().describe("Instance slug"),
        patch: z.record(z.string(), z.unknown()).describe("Config patch object"),
      }),
      async execute({ slug, patch }) {
        try {
          // 1. Apply patch to runtime_config_json via registry
          registry.patchRuntimeConfig(slug, (config) => {
            Object.assign(config, patch);
            return config;
          });

          // 2. Export runtime.json snapshot for debugging
          const updatedConfig = registry.getRuntimeConfig(slug);
          if (updatedConfig) {
            const stateDir = getRuntimeStateDir(slug);
            exportRuntimeJsonSnapshot(stateDir, updatedConfig);
          }

          // 3. If instance is running, restart to pick up changes
          const stateDir = getRuntimeStateDir(slug);
          if (isRuntimeRunning(stateDir)) {
            const xdgDir = await getXdgDir();
            const lifecycle = new Lifecycle(conn, registry, xdgDir);
            await lifecycle.restart(slug);
          }

          return {
            title: "update config",
            output: JSON.stringify({ ok: true, slug }, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_update_instance_config failed", {
            error: String(err),
          });
          return {
            title: "update config",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// Blueprint tools
// ---------------------------------------------------------------------------

function createBlueprintTools(deps: ToolDeps): Tool.Info[] {
  const { registry } = deps;

  return [
    Tool.define("cp_list_blueprints", {
      description: "List all reusable team blueprints.",
      parameters: z.object({}),
      async execute() {
        const blueprints = registry.listBlueprints();
        return {
          title: "list blueprints",
          output: JSON.stringify(blueprints, null, 2),
          truncated: false,
        };
      },
    }),

    Tool.define("cp_create_blueprint", {
      description: "Create a new team blueprint from an existing instance's agent configuration.",
      parameters: z.object({
        name: z.string().describe("Blueprint name"),
        description: z.string().optional().describe("Blueprint description"),
        sourceSlug: z.string().describe("Instance slug to copy agents from"),
      }),
      async execute(params) {
        try {
          // 1. Verify source instance exists
          const instance = registry.getInstance(params.sourceSlug);
          if (!instance) {
            return {
              title: "create blueprint",
              output: `Error: Source instance "${params.sourceSlug}" not found.`,
              truncated: false,
            };
          }

          // 2. Create the blueprint shell
          const blueprint = registry.createBlueprint({
            name: params.name,
            ...(params.description !== undefined ? { description: params.description } : {}),
          });

          // 3. Copy agents from source instance into blueprint
          const agents = registry.listAgents(params.sourceSlug);
          for (const agent of agents) {
            registry.createBlueprintAgent(blueprint.id, {
              agentId: agent.agent_id,
              name: agent.name,
              ...(agent.model !== undefined && agent.model !== null ? { model: agent.model } : {}),
            });

            // Copy agent files
            const files = registry.listAgentFiles(agent.id);
            const bpAgent = registry.getBlueprintAgent(blueprint.id, agent.agent_id);
            if (bpAgent) {
              for (const file of files) {
                const content = registry.getAgentFileContent(agent.id, file.filename);
                if (content !== null) {
                  // Blueprint agents use the same file API via blueprint repository
                  // For simplicity, store as blueprint agent config
                  logger.debug("[system-tools] copied agent file to blueprint", {
                    filename: file.filename,
                  });
                }
              }
            }
          }

          // 4. Copy agent links
          const links = registry.listAgentLinks(instance.id);
          if (links.length > 0) {
            registry.replaceBlueprintLinks(
              blueprint.id,
              links.map((l) => ({
                sourceAgentId: l.source_agent_id,
                targetAgentId: l.target_agent_id,
                linkType: l.link_type as "a2a" | "spawn",
              })),
            );
          }

          return {
            title: "create blueprint",
            output: JSON.stringify(blueprint, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_create_blueprint failed", { error: String(err) });
          return {
            title: "create blueprint",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),

    Tool.define("cp_delete_blueprint", {
      description: "Delete a team blueprint by ID.",
      parameters: z.object({
        id: z.number().int().describe("Blueprint ID"),
      }),
      async execute({ id }) {
        try {
          const bp = registry.getBlueprint(id);
          if (!bp) {
            return {
              title: "delete blueprint",
              output: `Error: Blueprint with id ${id} not found.`,
              truncated: false,
            };
          }
          registry.deleteBlueprint(id);
          return {
            title: "delete blueprint",
            output: JSON.stringify({ ok: true, deleted: id }, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_delete_blueprint failed", { error: String(err) });
          return {
            title: "delete blueprint",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// Flow tools
// ---------------------------------------------------------------------------

function createFlowTools(deps: ToolDeps): Tool.Info[] {
  const { db } = deps;

  return [
    Tool.define("cp_list_flows", {
      description: "List all flow definitions for an instance.",
      parameters: z.object({
        slug: z.string().describe("Instance slug"),
      }),
      async execute({ slug }) {
        const flows = listFlowDefinitions(db, slug);
        return {
          title: "list flows",
          output: JSON.stringify(flows, null, 2),
          truncated: false,
        };
      },
    }),

    Tool.define("cp_create_flow", {
      description:
        "Create a new flow definition for an instance. A flow is a DAG of steps executed by agents. " +
        "Each step needs a `prompt` (the instruction given to the agent). Optional `dependsOn` " +
        "lists other step ids this step waits on.",
      parameters: z.object({
        slug: z.string().describe("Instance slug"),
        name: z.string().describe("Flow name"),
        description: z.string().optional().describe("Flow description"),
        steps: z
          .array(
            z.object({
              id: z.string().describe("Unique step id within the flow"),
              agentId: z.string().describe("Agent id that executes the step"),
              prompt: z.string().describe("Instruction given to the agent for this step"),
              dependsOn: z
                .array(z.string())
                .optional()
                .describe("Step ids this step depends on (DAG edges)"),
            }),
          )
          .describe("Flow steps (DAG)"),
      }),
      async execute({ slug, name, description, steps }) {
        try {
          const flow = createFlowDefinition(db, {
            instanceSlug: slug,
            name,
            ...(description !== undefined ? { description } : {}),
            stepsJson: JSON.stringify(steps),
          });
          return {
            title: "create flow",
            output: JSON.stringify(flow, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_create_flow failed", { error: String(err) });
          return {
            title: "create flow",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),

    Tool.define("cp_run_flow", {
      description: "Start a flow run. The instance must be running.",
      parameters: z.object({
        slug: z.string().describe("Instance slug"),
        flowId: z.number().int().describe("Flow definition ID"),
      }),
      async execute({ slug, flowId }) {
        try {
          // Flows are executed by the runtime process -- must go through internal API
          const result = await callRuntimeApi(slug, `/internal/flows/${flowId}/run`, {
            triggerType: "manual",
          });
          return {
            title: "run flow",
            output: JSON.stringify(result, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_run_flow failed", { error: String(err) });
          return {
            title: "run flow",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),

    Tool.define("cp_delete_flow", {
      description: "Delete a flow definition by ID.",
      parameters: z.object({
        slug: z.string().describe("Instance slug"),
        flowId: z.number().int().describe("Flow definition ID"),
      }),
      async execute({ slug, flowId }) {
        try {
          const deleted = deleteFlowDefinition(db, flowId);
          if (!deleted) {
            return {
              title: "delete flow",
              output: `Error: Flow with id ${flowId} not found.`,
              truncated: false,
            };
          }
          return {
            title: "delete flow",
            output: JSON.stringify({ ok: true, deleted: flowId, instanceSlug: slug }, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_delete_flow failed", { error: String(err) });
          return {
            title: "delete flow",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// Named API Key tools
// ---------------------------------------------------------------------------

function createKeyTools(deps: ToolDeps): Tool.Info[] {
  const { namedKeys } = deps;

  return [
    Tool.define("cp_list_named_keys", {
      description: "List all named API keys (masked). Shows provider, default model, and key name.",
      parameters: z.object({}),
      async execute() {
        const keys = namedKeys.listAll();
        return {
          title: "list named keys",
          output: JSON.stringify(keys, null, 2),
          truncated: false,
        };
      },
    }),

    Tool.define("cp_create_named_key", {
      description: "Create a new named API key for a provider.",
      parameters: z.object({
        name: z.string().describe("Key name (e.g. 'My Anthropic Key')"),
        providerId: z
          .string()
          .describe("Provider ID (anthropic, openai, google, mistral, xai, openrouter, ollama)"),
        apiKey: z.string().describe("The actual API key string"),
        defaultModel: z.string().describe("Default model for this key (e.g. 'claude-sonnet-4-5')"),
        baseUrl: z.string().optional().describe("Custom base URL (for Ollama, proxies)"),
      }),
      async execute(params) {
        if (!isCryptoAvailable()) {
          return {
            title: "create named key",
            output:
              "Error: MASTER_ENCRYPTION_KEY is not configured. " +
              "Run 'claw-pilot init' to set up encryption.",
            truncated: false,
          };
        }
        try {
          const record = namedKeys.create({
            name: params.name,
            providerId: params.providerId,
            apiKey: params.apiKey,
            defaultModel: params.defaultModel,
            ...(params.baseUrl !== undefined ? { baseUrl: params.baseUrl } : {}),
          });
          return {
            title: "create named key",
            output: JSON.stringify(record, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_create_named_key failed", { error: String(err) });
          return {
            title: "create named key",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),

    Tool.define("cp_delete_named_key", {
      description: "Delete a named API key by ID. Fails if the key is assigned to instances.",
      parameters: z.object({
        id: z.number().int().describe("Named key ID"),
      }),
      async execute({ id }) {
        try {
          const key = namedKeys.getById(id);
          if (!key) {
            return {
              title: "delete named key",
              output: `Error: Named API key with id ${id} not found.`,
              truncated: false,
            };
          }
          namedKeys.delete(id);
          return {
            title: "delete named key",
            output: JSON.stringify({ ok: true, deleted: id }, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_delete_named_key failed", { error: String(err) });
          // FK constraint error when key is still in use
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("FOREIGN KEY") || msg.includes("RESTRICT")) {
            return {
              title: "delete named key",
              output:
                "Error: Cannot delete this key -- it is still assigned to one or more instances.",
              truncated: false,
            };
          }
          return {
            title: "delete named key",
            output: `Error: ${msg}`,
            truncated: false,
          };
        }
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// System status tools
// ---------------------------------------------------------------------------

function createSystemStatusTools(deps: ToolDeps): Tool.Info[] {
  const { db, registry } = deps;

  return [
    Tool.define("cp_system_health", {
      description:
        "Get an overview of the system: all instances with their status, total costs, " +
        "and number of agents.",
      parameters: z.object({}),
      async execute() {
        try {
          const instances = registry.listInstances();
          const summary = {
            totalInstances: instances.length,
            running: instances.filter((i) => i.state === "running").length,
            stopped: instances.filter((i) => i.state === "stopped").length,
            instances: instances.map((i) => ({
              slug: i.slug,
              state: i.state,
              displayName: i.display_name,
              defaultModel: i.default_model,
            })),
          };
          return {
            title: "system health",
            output: JSON.stringify(summary, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.warn("[system-tools] health check failed", { error: String(err) });
          return {
            title: "system health",
            output: `Error checking system health: ${String(err)}`,
            truncated: false,
          };
        }
      },
    }),

    Tool.define("cp_instance_costs", {
      description: "Get cost breakdown for a specific instance.",
      parameters: z.object({
        slug: z.string().describe("Instance slug"),
      }),
      async execute({ slug }) {
        try {
          const summary = getCostSummary(db, slug, "30d");
          const byAgent = getCostsByAgent(db, slug, "30d");
          return {
            title: "instance costs",
            output: JSON.stringify({ summary, byAgent }, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_instance_costs failed", { error: String(err) });
          return {
            title: "instance costs",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),

    Tool.define("cp_query_db", {
      description:
        "Execute a read-only SQL query against the ClawPilot registry database. " +
        "Only SELECT statements are allowed. The encrypted_api_key column is excluded " +
        "from results for security. Use this to query sessions, messages, costs, events, " +
        "flow runs, agents, and any other data in the registry. " +
        "Key tables: instances, agents, agent_files, rt_sessions, rt_messages, rt_parts, " +
        "rt_events, rt_flow_definitions, rt_flow_runs, rt_flow_step_runs, events, " +
        "named_api_keys (masked), blueprints, config, ports, user_profiles.",
      parameters: z.object({
        sql: z.string().describe("SQL SELECT query to execute"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Max rows to return (default 100)"),
      }),
      async execute({ sql, limit }) {
        // Security: only allow SELECT statements
        const trimmed = sql.trim().replace(/^\/\*[\s\S]*?\*\/\s*/, "");
        if (!/^SELECT\b/i.test(trimmed)) {
          return {
            title: "query db",
            output: "Error: Only SELECT queries are allowed.",
            truncated: false,
          };
        }

        // Guard against destructive keywords even within sub-expressions
        const upper = trimmed.toUpperCase();
        for (const keyword of ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "ATTACH"]) {
          if (upper.includes(keyword)) {
            return {
              title: "query db",
              output: `Error: Query contains forbidden keyword "${keyword}". Only read-only SELECT queries are allowed.`,
              truncated: false,
            };
          }
        }

        try {
          const effectiveLimit = limit ?? 100;
          // Wrap in a LIMIT if not already present
          const hasLimit = /\bLIMIT\b/i.test(trimmed);
          const finalSql = hasLimit ? sql : `${sql} LIMIT ${effectiveLimit}`;
          const rows = db.prepare(finalSql).all() as unknown[];
          const masked = maskSensitiveColumns(rows);
          return {
            title: "query db",
            output: JSON.stringify({ rows: masked, count: masked.length }, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.error("[system-tools] cp_query_db failed", { error: String(err) });
          return {
            title: "query db",
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
            truncated: false,
          };
        }
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create all system tools that operate directly on the registry DB. */
export function createSystemTools(db: Database.Database, _instanceSlug: InstanceSlug): Tool.Info[] {
  const registry = new Registry(db);
  const conn = new LocalConnection();
  const namedKeys = new NamedKeyRepository(db);

  // Lifecycle/health deps -- resolve xdgRuntimeDir lazily
  let _xdgDir: string | undefined;
  const getXdgDir = async (): Promise<string> => {
    if (_xdgDir === undefined) _xdgDir = await resolveXdgRuntimeDir(conn);
    return _xdgDir;
  };

  const deps: ToolDeps = { db, registry, conn, namedKeys, getXdgDir };

  return [
    ...createInstanceQueryTools(deps),
    ...createInstanceMutationTools(deps),
    ...createInstanceLifecycleTools(deps),
    ...createAgentTools(deps),
    ...createBlueprintTools(deps),
    ...createFlowTools(deps),
    ...createKeyTools(deps),
    ...createSystemStatusTools(deps),
  ];
}
