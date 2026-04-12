// src/runtime/plugin/system-dashboard/tools.ts
//
// Tool definitions for the system-pilot agent.
// Each tool calls the dashboard REST API via HTTP — no import coupling.

import { z } from "zod";
import { Tool } from "../../tool/tool.js";
import { logger } from "../../../lib/logger.js";

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function dashboardFetch(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = `${baseUrl}/api${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    logger.debug("[system-dashboard] JSON parse failed, falling back to text", {
      error: String(err),
    });
    data = {
      raw: await res.text().catch((textErr) => {
        logger.debug("[system-dashboard] text() fallback also failed", {
          error: String(textErr),
        });
        return "";
      }),
    };
  }

  if (!res.ok) {
    const msg =
      typeof data === "object" && data !== null && "message" in data
        ? String((data as { message: string }).message)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return { status: res.status, data };
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/** Create all system dashboard tools that call the dashboard REST API. */
export function createSystemDashboardTools(
  dashboardUrl: string,
  dashboardToken: string,
): Tool.Info[] {
  const api = (method: string, path: string, body?: unknown) =>
    dashboardFetch(dashboardUrl, dashboardToken, method, path, body);

  return [
    // --- Instance tools ---

    Tool.define("cp_list_instances", {
      description:
        "List all claw-pilot instances with their status, port, and model. " +
        "Returns an array of instance objects.",
      parameters: z.object({}),
      async execute() {
        const { data } = await api("GET", "/instances");
        return { title: "list instances", output: JSON.stringify(data, null, 2), truncated: false };
      },
    }),

    Tool.define("cp_get_instance", {
      description: "Get detailed information about a specific instance by its slug.",
      parameters: z.object({
        slug: z.string().describe("Instance slug (e.g. 'my-team')"),
      }),
      async execute({ slug }) {
        const { data } = await api("GET", `/instances/${encodeURIComponent(slug)}`);
        return { title: "get instance", output: JSON.stringify(data, null, 2), truncated: false };
      },
    }),

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
        const body = {
          slug: params.slug,
          ...(params.displayName !== undefined ? { displayName: params.displayName } : {}),
          defaultModel: params.defaultModel,
          namedKeyId: params.namedKeyId,
          agents: params.agents ?? [{ id: "default", name: "Default", isDefault: true }],
        };
        const { data } = await api("POST", "/instances", body);
        return {
          title: "create instance",
          output: JSON.stringify(data, null, 2),
          truncated: false,
        };
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
        const { data } = await api("DELETE", `/instances/${encodeURIComponent(slug)}`);
        return {
          title: "delete instance",
          output: JSON.stringify(data, null, 2),
          truncated: false,
        };
      },
    }),

    Tool.define("cp_start_instance", {
      description: "Start a stopped instance runtime daemon.",
      parameters: z.object({
        slug: z.string().describe("Instance slug to start"),
      }),
      async execute({ slug }) {
        const { data } = await api("POST", `/instances/${encodeURIComponent(slug)}/start`);
        return { title: "start instance", output: JSON.stringify(data, null, 2), truncated: false };
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
        const { data } = await api("POST", `/instances/${encodeURIComponent(slug)}/stop`);
        return { title: "stop instance", output: JSON.stringify(data, null, 2), truncated: false };
      },
    }),

    Tool.define("cp_restart_instance", {
      description: "Restart a running instance runtime daemon.",
      parameters: z.object({
        slug: z.string().describe("Instance slug to restart"),
      }),
      async execute({ slug }) {
        const { data } = await api("POST", `/instances/${encodeURIComponent(slug)}/restart`);
        return {
          title: "restart instance",
          output: JSON.stringify(data, null, 2),
          truncated: false,
        };
      },
    }),

    // --- Agent tools ---

    Tool.define("cp_list_agents", {
      description: "List all agents configured for a specific instance.",
      parameters: z.object({
        slug: z.string().describe("Instance slug"),
      }),
      async execute({ slug }) {
        const { data } = await api("GET", `/instances/${encodeURIComponent(slug)}/config`);
        const config = data as { agents?: unknown[] };
        return {
          title: "list agents",
          output: JSON.stringify(config.agents ?? [], null, 2),
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
        const { data } = await api("PATCH", `/instances/${encodeURIComponent(slug)}/config`, patch);
        return {
          title: "update config",
          output: JSON.stringify(data, null, 2),
          truncated: false,
        };
      },
    }),

    // --- Blueprint tools ---

    Tool.define("cp_list_blueprints", {
      description: "List all reusable team blueprints.",
      parameters: z.object({}),
      async execute() {
        const { data } = await api("GET", "/blueprints");
        return {
          title: "list blueprints",
          output: JSON.stringify(data, null, 2),
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
        const { data } = await api("POST", "/blueprints", params);
        return {
          title: "create blueprint",
          output: JSON.stringify(data, null, 2),
          truncated: false,
        };
      },
    }),

    Tool.define("cp_delete_blueprint", {
      description: "Delete a team blueprint by ID.",
      parameters: z.object({
        id: z.number().int().describe("Blueprint ID"),
      }),
      async execute({ id }) {
        const { data } = await api("DELETE", `/blueprints/${id}`);
        return {
          title: "delete blueprint",
          output: JSON.stringify(data, null, 2),
          truncated: false,
        };
      },
    }),

    // --- Flow tools ---

    Tool.define("cp_list_flows", {
      description: "List all flow definitions for an instance.",
      parameters: z.object({
        slug: z.string().describe("Instance slug"),
      }),
      async execute({ slug }) {
        const { data } = await api("GET", `/instances/${encodeURIComponent(slug)}/runtime/flows`);
        return { title: "list flows", output: JSON.stringify(data, null, 2), truncated: false };
      },
    }),

    Tool.define("cp_create_flow", {
      description:
        "Create a new flow definition for an instance. A flow is a DAG of steps executed by agents.",
      parameters: z.object({
        slug: z.string().describe("Instance slug"),
        name: z.string().describe("Flow name"),
        description: z.string().optional().describe("Flow description"),
        steps: z
          .array(
            z.object({
              id: z.string(),
              agentId: z.string(),
              briefing: z.string(),
              dependsOn: z.array(z.string()).optional(),
            }),
          )
          .describe("Flow steps (DAG)"),
      }),
      async execute({ slug, ...body }) {
        const { data } = await api(
          "POST",
          `/instances/${encodeURIComponent(slug)}/runtime/flows`,
          body,
        );
        return { title: "create flow", output: JSON.stringify(data, null, 2), truncated: false };
      },
    }),

    Tool.define("cp_run_flow", {
      description: "Start a flow run. The instance must be running.",
      parameters: z.object({
        slug: z.string().describe("Instance slug"),
        flowId: z.number().int().describe("Flow definition ID"),
      }),
      async execute({ slug, flowId }) {
        const { data } = await api(
          "POST",
          `/instances/${encodeURIComponent(slug)}/runtime/flows/${flowId}/run`,
          { triggerType: "manual" },
        );
        return { title: "run flow", output: JSON.stringify(data, null, 2), truncated: false };
      },
    }),

    Tool.define("cp_delete_flow", {
      description: "Delete a flow definition by ID.",
      parameters: z.object({
        slug: z.string().describe("Instance slug"),
        flowId: z.number().int().describe("Flow definition ID"),
      }),
      async execute({ slug, flowId }) {
        const { data } = await api(
          "DELETE",
          `/instances/${encodeURIComponent(slug)}/runtime/flows/${flowId}`,
        );
        return { title: "delete flow", output: JSON.stringify(data, null, 2), truncated: false };
      },
    }),

    // --- Named API Key tools ---

    Tool.define("cp_list_named_keys", {
      description: "List all named API keys (masked). Shows provider, default model, and key name.",
      parameters: z.object({}),
      async execute() {
        const { data } = await api("GET", "/named-keys");
        return {
          title: "list named keys",
          output: JSON.stringify(data, null, 2),
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
        const { data } = await api("POST", "/named-keys", params);
        return {
          title: "create named key",
          output: JSON.stringify(data, null, 2),
          truncated: false,
        };
      },
    }),

    Tool.define("cp_delete_named_key", {
      description: "Delete a named API key by ID. Fails if the key is assigned to instances.",
      parameters: z.object({
        id: z.number().int().describe("Named key ID"),
      }),
      async execute({ id }) {
        const { data } = await api("DELETE", `/named-keys/${id}`);
        return {
          title: "delete named key",
          output: JSON.stringify(data, null, 2),
          truncated: false,
        };
      },
    }),

    // --- System status tool ---

    Tool.define("cp_system_health", {
      description:
        "Get an overview of the system: all instances with their status, total costs, " +
        "and number of agents.",
      parameters: z.object({}),
      async execute() {
        try {
          const { data } = await api("GET", "/instances");
          const instances = Array.isArray(data) ? data : [];
          const summary = {
            totalInstances: instances.length,
            running: instances.filter((i: { state?: string }) => i.state === "running").length,
            stopped: instances.filter((i: { state?: string }) => i.state === "stopped").length,
            instances: instances.map(
              (i: {
                slug?: string;
                state?: string;
                display_name?: string;
                default_model?: string;
              }) => ({
                slug: i.slug,
                state: i.state,
                displayName: i.display_name,
                defaultModel: i.default_model,
              }),
            ),
          };
          return {
            title: "system health",
            output: JSON.stringify(summary, null, 2),
            truncated: false,
          };
        } catch (err) {
          logger.warn("[system-dashboard] health check failed", { error: String(err) });
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
        const { data } = await api("GET", `/instances/${encodeURIComponent(slug)}/costs`);
        return {
          title: "instance costs",
          output: JSON.stringify(data, null, 2),
          truncated: false,
        };
      },
    }),

    // --- Database query tool ---

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
        const { data } = await api("POST", "/system/query", { sql, limit: limit ?? 100 });
        return {
          title: "query db",
          output: JSON.stringify(data, null, 2),
          truncated: false,
        };
      },
    }),
  ];
}
