// src/core/registry.ts
//
// Facade over the 7 sub-repositories. Preserves the full public interface so
// all callers (commands, dashboard routes, tests) require zero changes.
//
// Sub-repositories live in src/core/repositories/:
//   server-repository.ts    — servers table
//   instance-repository.ts  — instances table
//   agent-repository.ts     — agents + agent_files + agent_links tables
//   port-repository.ts      — ports table
//   config-repository.ts    — config table
//   event-repository.ts     — events table
//   blueprint-repository.ts — blueprints + blueprint agents + blueprint links

import type Database from "better-sqlite3";
import { ServerRepository } from "./repositories/server-repository.js";
import { InstanceRepository } from "./repositories/instance-repository.js";
import { AgentRepository } from "./repositories/agent-repository.js";
import { PortRepository } from "./repositories/port-repository.js";
import { ConfigRepository } from "./repositories/config-repository.js";
import { EventRepository } from "./repositories/event-repository.js";
import { BlueprintRepository } from "./repositories/blueprint-repository.js";
import { AgentBlueprintRepository } from "./repositories/agent-blueprint-repository.js";
import { UserProfileRepository } from "./repositories/user-profile-repository.js";
import type { InstanceRecord } from "./registry-types.js";

// ---------------------------------------------------------------------------
// Re-exported types — callers import from "registry.js", source of truth is
// registry-types.ts (avoids circular deps with sub-repositories)
// ---------------------------------------------------------------------------

export type {
  ServerRecord,
  InstanceRecord,
  AgentRecord,
  AgentFileRecord,
  AgentLinkRecord,
  BlueprintRecord,
  BlueprintAgentRecord,
  BlueprintLinkRecord,
  AgentBlueprintRecord,
  AgentBlueprintFileRecord,
  UserProfileRecord,
  UserProviderRecord,
} from "./registry-types.js";

// ---------------------------------------------------------------------------
// Registry facade
// ---------------------------------------------------------------------------

export class Registry {
  private servers: ServerRepository;
  private instances: InstanceRepository;
  private agents: AgentRepository;
  private ports: PortRepository;
  private configs: ConfigRepository;
  private events: EventRepository;
  private blueprints: BlueprintRepository;
  private agentBlueprints: AgentBlueprintRepository;
  private _userProfiles: UserProfileRepository;

  constructor(private db: Database.Database) {
    this.servers = new ServerRepository(db);
    this.instances = new InstanceRepository(db);
    this.agents = new AgentRepository(db);
    this.ports = new PortRepository(db);
    this.configs = new ConfigRepository(db);
    this.events = new EventRepository(db);
    this.blueprints = new BlueprintRepository(db);
    this.agentBlueprints = new AgentBlueprintRepository(db);
    this._userProfiles = new UserProfileRepository(db);
  }

  /** Expose the underlying database handle for transaction-level operations. */
  getDb(): Database.Database {
    return this.db;
  }

  // --- Servers ---
  getLocalServer() {
    return this.servers.getLocalServer();
  }
  upsertLocalServer(hostname: string, homeDir: string, ip?: string) {
    return this.servers.upsertLocalServer(hostname, homeDir, ip);
  }

  // --- Instances ---
  listInstances() {
    return this.instances.listInstances();
  }
  getInstance(slug: string) {
    return this.instances.getInstance(slug);
  }
  createInstance(data: Parameters<InstanceRepository["createInstance"]>[0]) {
    return this.instances.createInstance(data);
  }
  updateInstanceState(slug: string, state: InstanceRecord["state"]) {
    return this.instances.updateInstanceState(slug, state);
  }
  updateInstance(slug: string, fields: Parameters<InstanceRepository["updateInstance"]>[1]) {
    return this.instances.updateInstance(slug, fields);
  }
  deleteInstance(slug: string) {
    return this.instances.deleteInstance(slug);
  }

  // --- Agents ---
  listAgents(instanceSlug: string) {
    return this.agents.listAgents(instanceSlug);
  }
  createAgent(instanceId: number, data: Parameters<AgentRepository["createAgent"]>[1]) {
    return this.agents.createAgent(instanceId, data);
  }
  deleteAgents(instanceId: number) {
    return this.agents.deleteAgents(instanceId);
  }
  deleteAgentById(agentDbId: number) {
    return this.agents.deleteAgentById(agentDbId);
  }
  upsertAgent(instanceId: number, data: Parameters<AgentRepository["upsertAgent"]>[1]) {
    return this.agents.upsertAgent(instanceId, data);
  }
  getAgentByAgentId(instanceId: number, agentId: string) {
    return this.agents.getAgentByAgentId(instanceId, agentId);
  }
  updateAgentMeta(agentDbId: number, fields: Parameters<AgentRepository["updateAgentMeta"]>[1]) {
    return this.agents.updateAgentMeta(agentDbId, fields);
  }
  updateAgentPosition(agentDbId: number, x: number, y: number) {
    return this.agents.updateAgentPosition(agentDbId, x, y);
  }
  updateAgentSync(agentDbId: number, fields: Parameters<AgentRepository["updateAgentSync"]>[1]) {
    return this.agents.updateAgentSync(agentDbId, fields);
  }

  // --- Agent Files ---
  listAgentFiles(agentDbId: number) {
    return this.agents.listAgentFiles(agentDbId);
  }
  upsertAgentFile(agentDbId: number, data: Parameters<AgentRepository["upsertAgentFile"]>[1]) {
    return this.agents.upsertAgentFile(agentDbId, data);
  }
  deleteAgentFile(agentDbId: number, filename: string) {
    return this.agents.deleteAgentFile(agentDbId, filename);
  }
  getAgentFileContent(agentDbId: number, filename: string) {
    return this.agents.getAgentFileContent(agentDbId, filename);
  }

  // --- Agent Links ---
  listAgentLinks(instanceId: number) {
    return this.agents.listAgentLinks(instanceId);
  }
  replaceAgentLinks(
    instanceId: number,
    links: Parameters<AgentRepository["replaceAgentLinks"]>[1],
  ) {
    return this.agents.replaceAgentLinks(instanceId, links);
  }

  // --- Ports ---
  allocatePort(serverId: number, port: number, instanceSlug: string) {
    return this.ports.allocatePort(serverId, port, instanceSlug);
  }
  releasePort(serverId: number, port: number) {
    return this.ports.releasePort(serverId, port);
  }
  getUsedPorts(serverId: number) {
    return this.ports.getUsedPorts(serverId);
  }

  // --- Config ---
  getConfig(key: string) {
    return this.configs.getConfig(key);
  }
  setConfig(key: string, value: string) {
    return this.configs.setConfig(key, value);
  }

  // --- Events ---
  logEvent(instanceSlug: string | null, eventType: string, detail?: string) {
    return this.events.logEvent(instanceSlug, eventType, detail);
  }
  listEvents(instanceSlug?: string, limit = 50) {
    return this.events.listEvents(instanceSlug, limit);
  }

  // --- Blueprints ---
  listBlueprints() {
    return this.blueprints.listBlueprints();
  }
  getBlueprint(id: number) {
    return this.blueprints.getBlueprint(id);
  }
  createBlueprint(data: Parameters<BlueprintRepository["createBlueprint"]>[0]) {
    return this.blueprints.createBlueprint(data);
  }
  updateBlueprint(id: number, fields: Parameters<BlueprintRepository["updateBlueprint"]>[1]) {
    return this.blueprints.updateBlueprint(id, fields);
  }
  deleteBlueprint(id: number) {
    return this.blueprints.deleteBlueprint(id);
  }

  // --- Blueprint Agents ---
  listBlueprintAgents(blueprintId: number) {
    return this.blueprints.listBlueprintAgents(blueprintId);
  }
  getBlueprintAgent(blueprintId: number, agentId: string) {
    return this.blueprints.getBlueprintAgent(blueprintId, agentId);
  }
  createBlueprintAgent(
    blueprintId: number,
    data: Parameters<BlueprintRepository["createBlueprintAgent"]>[1],
  ) {
    return this.blueprints.createBlueprintAgent(blueprintId, data);
  }
  deleteBlueprintAgent(blueprintId: number, agentId: string) {
    return this.blueprints.deleteBlueprintAgent(blueprintId, agentId);
  }
  updateBlueprintAgentPosition(agentDbId: number, x: number, y: number) {
    return this.blueprints.updateBlueprintAgentPosition(agentDbId, x, y);
  }

  // --- Blueprint Links ---
  listBlueprintLinks(blueprintId: number) {
    return this.blueprints.listBlueprintLinks(blueprintId);
  }
  replaceBlueprintLinks(
    blueprintId: number,
    links: Parameters<BlueprintRepository["replaceBlueprintLinks"]>[1],
  ) {
    return this.blueprints.replaceBlueprintLinks(blueprintId, links);
  }

  // --- Blueprint Builder Data ---
  getBlueprintBuilderData(blueprintId: number) {
    return this.blueprints.getBlueprintBuilderData(blueprintId);
  }

  // --- Agent Blueprints (standalone reusable agent templates) ---
  listAgentBlueprints() {
    return this.agentBlueprints.listAgentBlueprints();
  }
  getAgentBlueprint(id: string) {
    return this.agentBlueprints.getAgentBlueprint(id);
  }
  createAgentBlueprint(data: Parameters<AgentBlueprintRepository["createAgentBlueprint"]>[0]) {
    return this.agentBlueprints.createAgentBlueprint(data);
  }
  updateAgentBlueprint(
    id: string,
    fields: Parameters<AgentBlueprintRepository["updateAgentBlueprint"]>[1],
  ) {
    return this.agentBlueprints.updateAgentBlueprint(id, fields);
  }
  deleteAgentBlueprint(id: string) {
    return this.agentBlueprints.deleteAgentBlueprint(id);
  }
  cloneAgentBlueprint(sourceId: string, newName?: string) {
    return this.agentBlueprints.cloneAgentBlueprint(sourceId, newName);
  }

  // --- Agent Blueprint Files ---
  listAgentBlueprintFiles(blueprintId: string) {
    return this.agentBlueprints.listAgentBlueprintFiles(blueprintId);
  }
  getAgentBlueprintFile(blueprintId: string, filename: string) {
    return this.agentBlueprints.getAgentBlueprintFile(blueprintId, filename);
  }
  upsertAgentBlueprintFile(blueprintId: string, filename: string, content: string) {
    return this.agentBlueprints.upsertAgentBlueprintFile(blueprintId, filename, content);
  }
  deleteAgentBlueprintFile(blueprintId: string, filename: string) {
    return this.agentBlueprints.deleteAgentBlueprintFile(blueprintId, filename);
  }

  // --- User Profiles ---

  /** Expose the UserProfileRepository for ProfileResolver construction */
  get userProfiles(): UserProfileRepository {
    return this._userProfiles;
  }

  getUserProfile(userId: number) {
    return this._userProfiles.getProfile(userId);
  }
  getAdminProfile() {
    return this._userProfiles.getAdminProfile();
  }
  upsertUserProfile(userId: number, data: Parameters<UserProfileRepository["upsertProfile"]>[1]) {
    return this._userProfiles.upsertProfile(userId, data);
  }

  getUserProviders(userId: number) {
    return this._userProfiles.getProviders(userId);
  }
  upsertUserProvider(userId: number, data: Parameters<UserProfileRepository["upsertProvider"]>[1]) {
    return this._userProfiles.upsertProvider(userId, data);
  }
  removeUserProvider(userId: number, providerId: string) {
    return this._userProfiles.removeProvider(userId, providerId);
  }
}
