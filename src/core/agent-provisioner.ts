// src/core/agent-provisioner.ts
import type { ServerConnection } from "../server/connection.js";
import type { Registry, InstanceRecord } from "./registry.js";

export interface CreateAgentData {
  agentSlug: string;
  name: string;
  role: string;
  provider: string;
  model: string;
}

const DISCOVERABLE_FILES = [
  "AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md",
  "USER.md", "HEARTBEAT.md", "MEMORY.md", "BOOTSTRAP.md",
];

export class AgentProvisioner {
  constructor(
    private conn: ServerConnection,
    private registry: Registry,
  ) {}

  async createAgent(instance: InstanceRecord, data: CreateAgentData): Promise<void> {
    // 1. Validate slug uniqueness
    const existing = this.registry.getAgentByAgentId(instance.id, data.agentSlug);
    if (existing) throw new Error(`Agent "${data.agentSlug}" already exists`);

    // 2. Determine workspace dir from instance config_path
    // config_path is like /home/freebox/.openclaw/openclaw.json
    // openclawHome is the directory containing openclaw.json
    const path = await import("node:path");
    const openclawHome = path.dirname(instance.config_path);
    const workspaceDir = path.join(openclawHome, `workspace-${data.agentSlug}`);

    // 3. Create workspace directory
    await this.conn.mkdir(workspaceDir);

    // 4. Write minimal workspace files
    for (const filename of DISCOVERABLE_FILES) {
      await this.conn.writeFile(
        path.join(workspaceDir, filename),
        `# ${data.name}\n`,
      );
    }

    // 5. Read openclaw.json
    const configRaw = await this.conn.readFile(instance.config_path);
    const config = JSON.parse(configRaw) as Record<string, unknown>;

    // 6. Add agent to agents.list[]
    // Use absolute path so agent-sync.ts resolveWorkspace() doesn't mangle it
    // (resolveWorkspace prefixes stateDir/workspaces/ for relative paths)
    const agentsConf = (config["agents"] ?? {}) as Record<string, unknown>;
    config["agents"] = agentsConf;
    if (!Array.isArray(agentsConf["list"])) {
      agentsConf["list"] = [];
    }
    (agentsConf["list"] as unknown[]).push({
      id: data.agentSlug,
      name: data.name,
      model: `${data.provider}/${data.model}`,
      workspace: workspaceDir,  // absolute path — avoids resolveWorkspace() prefix bug
    });

    // 7. Write openclaw.json back
    await this.conn.writeFile(
      instance.config_path,
      JSON.stringify(config, null, 2) + "\n",
    );

    // 8. Upsert agent in DB
    this.registry.upsertAgent(instance.id, {
      agentId: data.agentSlug,
      name: data.name,
      model: `${data.provider}/${data.model}`,
      workspacePath: workspaceDir,
      isDefault: false,
    });

    // Note: role is stored via updateAgentMeta after upsert
    if (data.role) {
      const agent = this.registry.getAgentByAgentId(instance.id, data.agentSlug);
      if (agent) {
        this.registry.updateAgentMeta(agent.id, { role: data.role });
      }
    }
  }
}
