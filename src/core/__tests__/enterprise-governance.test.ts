import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type Database from "better-sqlite3";
import { initDatabase } from "../../db/schema.js";
import {
  createArtifact,
  createBusinessTask,
  completeBusinessTask,
  getBusinessTask,
  reviewBusinessTask,
  transitionArtifact,
} from "../repositories/business-task-repository.js";
import {
  TeamRbacPermissionChecker,
  createTeam,
  setTeamMembership,
} from "../repositories/team-governance-repository.js";
import {
  createUseCase,
  setUseCaseLifecycle,
  startUseCaseLaunch,
} from "../repositories/use-case-repository.js";
import {
  createFlowDefinition,
  createFlowRun,
  getFlowDefinition,
  updateFlowRunStatus,
} from "../repositories/flow-repository.js";
import {
  transitionWorkflow,
  validateWorkflow,
} from "../repositories/workflow-governance-repository.js";
import {
  compareAgents,
  createAgentVersion,
  decideAgentPromotion,
  requestAgentPromotion,
  rollbackAgentVersion,
  snapshotAgentVersion,
} from "../repositories/agent-lifecycle-repository.js";
import {
  createExecution,
  completeExecution,
  startExecution,
} from "../repositories/execution-repository.js";
import {
  evaluateCostPolicy,
  upsertCostPolicy,
} from "../repositories/cost-governance-repository.js";
import { getAdoptionMetrics, listMetricDefinitions } from "../repositories/adoption-repository.js";

let tempDir: string;
let db: Database.Database;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-governance-"));
  db = initDatabase(path.join(tempDir, "test.db"));
  const server = db
    .prepare("INSERT INTO servers (hostname, openclaw_home) VALUES ('local', '/tmp')")
    .run();
  db.prepare(
    `INSERT INTO instances
     (server_id, slug, port, config_path, state_dir, systemd_unit, instance_type)
     VALUES (?, 'alpha', 19101, '/tmp/config', '/tmp/state', 'alpha.service', 'claw-runtime')`,
  ).run(server.lastInsertRowid);
  db.prepare(
    `INSERT INTO users (username, password_hash, role) VALUES
     ('owner', 'x', 'admin'), ('member', 'x', 'operator'), ('outsider', 'x', 'viewer')`,
  ).run();
  db.prepare(
    `INSERT INTO agents
     (instance_id, agent_id, name, workspace_path, config_json)
     VALUES ((SELECT id FROM instances WHERE slug = 'alpha'), 'analyst', 'Analyst', '/tmp/analyst',
       '{"model":"test","tools":["read"]}')`,
  ).run();
});

afterEach(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("EP-06 business tasks and artifacts", () => {
  it("preserves unknown initiators and records review and supersession state", () => {
    const task = createBusinessTask(db, {
      instanceSlug: "alpha",
      objective: "Produce the quarterly analysis",
      origin: "API_REQUEST",
    });
    expect(task.initiator_display).toBe("UNKNOWN");

    const reviewed = reviewBusinessTask(db, task.id, {
      status: "ACCEPTED",
      reviewerUserId: 1,
      timeSavedMinutes: 90,
      reviewEffortMinutes: 10,
      feedback: "Ready",
    });
    expect(reviewed).toMatchObject({ review_status: "ACCEPTED", time_saved_minutes: 90 });

    const first = createArtifact(db, {
      instanceSlug: "alpha",
      businessTaskId: task.id,
      title: "Draft",
      artifactType: "report",
    });
    const replacement = createArtifact(db, {
      instanceSlug: "alpha",
      businessTaskId: task.id,
      title: "Final",
      artifactType: "report",
      state: "READY_FOR_REVIEW",
    });
    expect(transitionArtifact(db, first.id, "SUPERSEDED", replacement.id)).toMatchObject({
      state: "SUPERSEDED",
      superseded_by_id: replacement.id,
    });
  });
});

describe("EP-07 team RBAC", () => {
  it("allows team members and denies cross-team access", async () => {
    const alpha = createTeam(db, { name: "Alpha", ownerUserId: 1 });
    const beta = createTeam(db, { name: "Beta" });
    setTeamMembership(db, { teamId: alpha.id, userId: 2, role: "MEMBER", actorUserId: 1 });
    const checker = new TeamRbacPermissionChecker(db);
    await expect(
      checker.check({
        user: { id: "2", username: "member", role: "operator", source: "session" },
        action: "artifact.read",
        resource: { kind: "team", id: alpha.id },
      }),
    ).resolves.toMatchObject({ allow: true });
    await expect(
      checker.check({
        user: { id: "2", username: "member", role: "operator", source: "session" },
        action: "artifact.read",
        resource: { kind: "team", id: beta.id },
      }),
    ).resolves.toMatchObject({ allow: false });
  });
});

describe("EP-08 use cases", () => {
  it("only launches validated, versioned catalog entries", () => {
    const useCase = createUseCase(db, {
      name: "Quarterly close",
      description: "Prepare close analysis",
      promptTemplate: "Analyze {{period}}",
      ownerUserId: 1,
      prerequisites: ["ledger"],
      examples: [{ period: "Q3" }],
    });
    expect(() => startUseCaseLaunch(db, { useCaseId: useCase.id, scope: {} })).toThrow();
    setUseCaseLifecycle(db, useCase.id, "VALIDATED");
    expect(
      startUseCaseLaunch(db, { useCaseId: useCase.id, userId: 1, scope: { period: "Q3" } }),
    ).toMatchObject({ version: 1, status: "STARTED" });
  });
});

describe("EP-09 workflow reliability", () => {
  it("validates dependencies and automatically pauses after repeated failures", () => {
    const flow = createFlowDefinition(db, {
      instanceSlug: "alpha",
      name: "Governed flow",
      stepsJson: JSON.stringify([{ id: "analyze", agentId: "analyst", prompt: "Analyze" }]),
      lifecycle: "DRAFT",
    });
    const report = validateWorkflow(db, flow.id, 1);
    expect(report).toMatchObject({ valid: true });
    expect(transitionWorkflow(db, flow.id, "ACTIVE", 1)).toMatchObject({ lifecycle: "ACTIVE" });

    for (let i = 0; i < 3; i++) {
      const run = createFlowRun(db, {
        flowId: flow.id,
        instanceSlug: "alpha",
        triggerType: "cron",
        idempotencyKey: `run-${i}`,
      });
      updateFlowRunStatus(db, run.id, "failed", "boom");
    }
    expect(getFlowDefinition(db, flow.id)).toMatchObject({ lifecycle: "PAUSED", enabled: 0 });
  });
});

describe("EP-10 agent lifecycle", () => {
  it("versions, compares, approves promotion, and rolls back non-destructively", () => {
    expect(snapshotAgentVersion(db, "alpha", "analyst", 1)?.version).toBe(1);
    const second = createAgentVersion(
      db,
      "alpha",
      "analyst",
      { model: "test-v2", tools: ["read", "grep"] },
      1,
    );
    expect(second?.version).toBe(2);
    expect(
      compareAgents(db, {
        instanceSlug: "alpha",
        leftAgentId: "analyst",
        rightAgentId: "analyst",
        leftVersion: 1,
        rightVersion: 2,
      })?.differences.map((item) => item.path),
    ).toContain("model");
    const approval = requestAgentPromotion(db, {
      instanceSlug: "alpha",
      agentId: "analyst",
      toState: "PRODUCTION",
      requestedByUserId: 1,
    });
    expect(decideAgentPromotion(db, approval, true, 1)).toBe(true);
    expect(rollbackAgentVersion(db, "alpha", "analyst", 1, 1)?.version).toBe(3);
  });
});

describe("EP-11 and EP-12 cost and adoption governance", () => {
  it("attributes estimated costs and excludes child-agent work from human adoption", () => {
    const team = createTeam(db, { name: "Finance", ownerUserId: 1 });
    db.prepare("UPDATE instances SET team_id = ? WHERE slug = 'alpha'").run(team.id);
    const human = createBusinessTask(db, {
      instanceSlug: "alpha",
      objective: "Human request",
      origin: "HUMAN_REQUEST",
      initiatorUserId: 1,
      teamId: team.id,
    });
    completeBusinessTask(db, human.id, "Done");
    reviewBusinessTask(db, human.id, { status: "ACCEPTED", reviewerUserId: 1 });
    const child = createBusinessTask(db, {
      instanceSlug: "alpha",
      objective: "Delegated work",
      origin: "AGENT_DELEGATION",
      parentBusinessTaskId: human.id,
      teamId: team.id,
    });
    completeBusinessTask(db, child.id, "Done");

    const execution = createExecution(db, {
      instanceSlug: "alpha",
      sessionId: "session-1",
      agentId: "analyst",
      timeoutMs: 1000,
      businessTaskId: human.id,
    });
    startExecution(db, execution.id);
    completeExecution(db, execution.id, {
      messageId: "result-1",
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 2,
    });
    expect(getBusinessTask(db, human.id)?.cost_usd).toBe(2);
    const policy = upsertCostPolicy(db, {
      scope: "TEAM",
      scopeId: team.id,
      ownerUserId: 1,
      mode: "WARN",
      limitUsd: 2,
    });
    expect(evaluateCostPolicy(db, policy)).toMatchObject({
      spentUsd: 2,
      action: "WARN",
      estimate: true,
    });

    const metrics = getAdoptionMetrics(db, { teamId: team.id });
    expect(metrics).toMatchObject({ activeHumanUsers: 1, completedTasks: 1, acceptedResults: 1 });
    expect(metrics.costPerAcceptedTaskUsd).toBe(2);
    expect(listMetricDefinitions(db).length).toBeGreaterThanOrEqual(6);
  });
});
