import { z } from "zod";
import type { Hono } from "hono";
import type { RouteDeps } from "../route-deps.js";
import { apiError } from "../route-deps.js";
import { permission } from "../middleware/permission.js";
import { ACTIONS } from "../middleware/permission-actions.js";
import {
  ARTIFACT_STATES,
  BUSINESS_TASK_ORIGINS,
  REVIEW_STATUSES,
  completeBusinessTask,
  createArtifact,
  createBusinessTask,
  getArtifact,
  getBusinessTask,
  listArtifacts,
  listBusinessTasks,
  reviewBusinessTask,
  transitionArtifact,
} from "../../core/repositories/business-task-repository.js";
import {
  TEAM_ROLES,
  createTeam,
  getTeam,
  listMemberships,
  listTeams,
  previewEffectiveGrant,
  previewSsoGroupSync,
  removeTeamMembership,
  setTeamMembership,
} from "../../core/repositories/team-governance-repository.js";
import {
  addUseCaseVersion,
  createUseCase,
  getUseCaseFunnel,
  listUseCases,
  setUseCaseLifecycle,
  startUseCaseLaunch,
  updateUseCaseLaunch,
} from "../../core/repositories/use-case-repository.js";
import {
  transitionWorkflow,
  validateWorkflow,
} from "../../core/repositories/workflow-governance-repository.js";
import {
  compareAgents,
  createAgentVersion,
  decideAgentPromotion,
  listUnusedAgents,
  requestAgentPromotion,
  rollbackAgentVersion,
  snapshotAgentVersion,
} from "../../core/repositories/agent-lifecycle-repository.js";
import {
  detectCostAnomalies,
  listApplicableCostPolicies,
  reconcileProviderBilling,
  upsertCostPolicy,
} from "../../core/repositories/cost-governance-repository.js";
import {
  getAdoptionMetrics,
  listMetricDefinitions,
} from "../../core/repositories/adoption-repository.js";

const nullableId = z.number().int().positive().optional();
const BusinessTaskSchema = z.object({
  objective: z.string().min(1).max(5000),
  origin: z.enum(BUSINESS_TASK_ORIGINS),
  initiatorUserId: nullableId,
  initiatorDisplay: z.string().min(1).max(200).optional(),
  teamId: z.string().uuid().optional(),
  useCaseId: z.string().uuid().optional(),
  parentBusinessTaskId: z.string().uuid().optional(),
  outcome: z.string().max(2000).optional(),
});
const ReviewSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
  reviewerUserId: nullableId,
  feedback: z.string().max(5000).optional(),
  timeSavedMinutes: z.number().nonnegative().max(1_000_000).optional(),
  reviewEffortMinutes: z.number().nonnegative().max(1_000_000).optional(),
});
const ArtifactSchema = z.object({
  title: z.string().min(1).max(500),
  artifactType: z.string().min(1).max(100),
  businessTaskId: z.string().uuid().optional(),
  requestId: z.string().optional(),
  messageId: z.string().optional(),
  contentRef: z.string().max(5000).optional(),
  state: z.enum(ARTIFACT_STATES).optional(),
  ownerUserId: nullableId,
  teamId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const TeamSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  ownerUserId: nullableId,
});
const MembershipSchema = z.object({
  role: z.enum(TEAM_ROLES),
  actorUserId: nullableId,
  source: z.enum(["MANUAL", "SSO_GROUP"]).optional(),
});
const UseCaseSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  promptTemplate: z.string().min(1).max(50_000),
  ownerUserId: nullableId,
  teamId: z.string().uuid().optional(),
  outputValidation: z.unknown().optional(),
  guidance: z.unknown().optional(),
  prerequisites: z.array(z.unknown()).optional(),
  examples: z.array(z.unknown()).optional(),
  limitations: z.string().max(10_000).optional(),
  troubleshooting: z.string().max(10_000).optional(),
  qualityRubric: z.unknown().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HonoContext = any;
const slugAttr = (c: HonoContext) => ({ slug: c.req.param("slug") });
const idResource = (c: HonoContext) => c.req.param("id");
const userId = (c: HonoContext): number | undefined => {
  const parsed = Number(c.get("user")?.id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

async function body<T extends z.ZodType>(c: HonoContext, schema: T) {
  return schema.safeParse(await c.req.json().catch(() => null));
}

export function registerGovernanceRoutes(app: Hono, deps: RouteDeps): void {
  registerTeamGovernanceRoutes(app, deps);
  registerUseCaseGovernanceRoutes(app, deps);
  registerGlobalCostGovernanceRoutes(app, deps);
  registerInstanceGovernanceRoutes(app, deps);
}

function registerTeamGovernanceRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;

  app.get(
    "/api/governance/teams",
    permission({ action: ACTIONS.GOVERNANCE_TEAM_LIST, resource: { kind: "team" } }),
    (c) => c.json({ teams: listTeams(db) }),
  );
  app.post(
    "/api/governance/teams",
    permission({ action: ACTIONS.GOVERNANCE_TEAM_CREATE, resource: { kind: "team" } }),
    async (c) => {
      const parsed = await body(c, TeamSchema);
      if (!parsed.success) return apiError(c, 400, "INVALID_TEAM", parsed.error.message);
      return c.json({ team: createTeam(db, parsed.data) }, 201);
    },
  );
  app.get(
    "/api/governance/teams/:id/members",
    permission({
      action: ACTIONS.GOVERNANCE_TEAM_MEMBERS,
      resource: { kind: "team", id: idResource },
    }),
    (c) => {
      if (!getTeam(db, c.req.param("id")))
        return apiError(c, 404, "TEAM_NOT_FOUND", "Team not found");
      return c.json({ memberships: listMemberships(db, c.req.param("id")) });
    },
  );
  app.put(
    "/api/governance/teams/:id/members/:userId",
    permission({
      action: ACTIONS.GOVERNANCE_TEAM_MEMBERS,
      resource: { kind: "team", id: idResource },
    }),
    async (c) => {
      const parsed = await body(c, MembershipSchema);
      if (!parsed.success) return apiError(c, 400, "INVALID_MEMBERSHIP", parsed.error.message);
      const memberUserId = Number(c.req.param("userId"));
      if (!Number.isSafeInteger(memberUserId))
        return apiError(c, 400, "INVALID_USER", "Invalid user id");
      return c.json({
        membership: setTeamMembership(db, {
          teamId: c.req.param("id"),
          userId: memberUserId,
          ...parsed.data,
          actorUserId: parsed.data.actorUserId ?? userId(c),
        }),
      });
    },
  );
  app.delete(
    "/api/governance/teams/:id/members/:userId",
    permission({
      action: ACTIONS.GOVERNANCE_TEAM_MEMBERS,
      resource: { kind: "team", id: idResource },
    }),
    (c) => {
      const removed = removeTeamMembership(
        db,
        c.req.param("id"),
        Number(c.req.param("userId")),
        userId(c),
      );
      return removed
        ? c.json({ ok: true })
        : apiError(c, 404, "MEMBERSHIP_NOT_FOUND", "Membership not found");
    },
  );
  app.post(
    "/api/governance/teams/:id/grants/preview",
    permission({
      action: ACTIONS.GOVERNANCE_GRANT_PREVIEW,
      resource: { kind: "team", id: idResource },
    }),
    async (c) => {
      const parsed = await body(
        c,
        z.object({
          userId: z.number().int().positive(),
          action: z.string().min(1),
          resourceKind: z.string().optional(),
        }),
      );
      if (!parsed.success) return apiError(c, 400, "INVALID_PREVIEW", parsed.error.message);
      return c.json(previewEffectiveGrant(db, { ...parsed.data, teamId: c.req.param("id") }));
    },
  );
  app.post(
    "/api/governance/sso/group-sync/preview",
    permission({ action: ACTIONS.GOVERNANCE_SSO_PREVIEW, resource: { kind: "team" } }),
    async (c) => {
      const parsed = await body(
        c,
        z.object({
          providerId: z.string().min(1).max(200),
          groupKeys: z.array(z.string().min(1).max(500)).max(1_000),
        }),
      );
      if (!parsed.success) return apiError(c, 400, "INVALID_SSO_PREVIEW", parsed.error.message);
      return c.json({
        dryRun: true,
        mappings: previewSsoGroupSync(db, parsed.data.providerId, parsed.data.groupKeys),
      });
    },
  );
}

function registerUseCaseGovernanceRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;
  app.get(
    "/api/governance/use-cases",
    permission({ action: ACTIONS.USE_CASE_LIST, resource: { kind: "use-case" } }),
    (c) => c.json({ useCases: listUseCases(db, { teamId: c.req.query("teamId") }) }),
  );
  app.post(
    "/api/governance/use-cases",
    permission({ action: ACTIONS.USE_CASE_MANAGE, resource: { kind: "use-case" } }),
    async (c) => {
      const parsed = await body(c, UseCaseSchema);
      if (!parsed.success) return apiError(c, 400, "INVALID_USE_CASE", parsed.error.message);
      return c.json({ useCase: createUseCase(db, parsed.data) }, 201);
    },
  );
  app.post(
    "/api/governance/use-cases/:id/versions",
    permission({ action: ACTIONS.USE_CASE_MANAGE, resource: { kind: "use-case", id: idResource } }),
    async (c) => {
      const parsed = await body(
        c,
        UseCaseSchema.pick({
          promptTemplate: true,
          outputValidation: true,
          guidance: true,
          prerequisites: true,
          examples: true,
        }),
      );
      if (!parsed.success) return apiError(c, 400, "INVALID_VERSION", parsed.error.message);
      const version = addUseCaseVersion(db, c.req.param("id"), {
        ...parsed.data,
        createdByUserId: userId(c),
      });
      return version
        ? c.json({ version }, 201)
        : apiError(c, 404, "USE_CASE_NOT_FOUND", "Use case not found");
    },
  );
  app.put(
    "/api/governance/use-cases/:id/lifecycle",
    permission({ action: ACTIONS.USE_CASE_MANAGE, resource: { kind: "use-case", id: idResource } }),
    async (c) => {
      const parsed = await body(
        c,
        z.object({
          lifecycle: z.enum(["DRAFT", "VALIDATING", "VALIDATED", "DEPRECATED", "ARCHIVED"]),
        }),
      );
      if (!parsed.success) return apiError(c, 400, "INVALID_LIFECYCLE", parsed.error.message);
      const useCase = setUseCaseLifecycle(db, c.req.param("id"), parsed.data.lifecycle);
      return useCase
        ? c.json({ useCase })
        : apiError(c, 404, "USE_CASE_NOT_FOUND", "Use case not found");
    },
  );
  app.get(
    "/api/governance/use-cases/:id/funnel",
    permission({
      action: ACTIONS.ADOPTION_ANALYTICS,
      resource: { kind: "use-case", id: idResource },
    }),
    (c) => c.json({ funnel: getUseCaseFunnel(db, c.req.param("id")) }),
  );
  app.post(
    "/api/governance/use-cases/:id/launches",
    permission({ action: ACTIONS.USE_CASE_LAUNCH, resource: { kind: "use-case", id: idResource } }),
    async (c) => {
      const parsed = await body(
        c,
        z.object({
          scope: z.record(z.string(), z.unknown()),
          reportingPeriod: z.unknown().optional(),
          outputConfig: z.unknown().optional(),
          prerequisites: z.record(z.string(), z.unknown()).optional(),
          teamId: z.string().uuid().optional(),
        }),
      );
      if (!parsed.success) return apiError(c, 400, "INVALID_LAUNCH", parsed.error.message);
      try {
        return c.json(
          {
            launch: startUseCaseLaunch(db, {
              useCaseId: c.req.param("id"),
              userId: userId(c),
              ...parsed.data,
            }),
          },
          201,
        );
      } catch (error) {
        return apiError(c, 409, "USE_CASE_NOT_READY", String(error));
      }
    },
  );
  app.patch(
    "/api/governance/use-case-launches/:id",
    permission({
      action: ACTIONS.USE_CASE_LAUNCH,
      resource: { kind: "use-case-launch", id: idResource },
    }),
    async (c) => {
      const parsed = await body(
        c,
        z.object({
          status: z.enum(["STARTED", "PREREQUISITES_PASSED", "EXECUTED", "COMPLETED", "ABANDONED"]),
          businessTaskId: z.string().uuid().optional(),
        }),
      );
      if (!parsed.success) return apiError(c, 400, "INVALID_LAUNCH", parsed.error.message);
      const launch = updateUseCaseLaunch(db, c.req.param("id"), parsed.data);
      return launch ? c.json({ launch }) : apiError(c, 404, "LAUNCH_NOT_FOUND", "Launch not found");
    },
  );
}

function registerGlobalCostGovernanceRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;
  app.get(
    "/api/governance/metrics/definitions",
    permission({ action: ACTIONS.ADOPTION_ANALYTICS, resource: { kind: "adoption" } }),
    (c) => c.json({ definitions: listMetricDefinitions(db) }),
  );
  app.post(
    "/api/governance/cost-policies",
    permission({ action: ACTIONS.COST_POLICY_MANAGE, resource: { kind: "cost-policy" } }),
    async (c) => {
      const parsed = await body(
        c,
        z.object({
          scope: z.enum(["PLATFORM", "TEAM", "INSTANCE", "WORKFLOW"]),
          scopeId: z.string().optional(),
          ownerUserId: nullableId,
          mode: z.enum(["MONITOR", "WARN", "ENFORCE"]).optional(),
          period: z.enum(["DAILY", "MONTHLY", "LIFETIME"]).optional(),
          limitUsd: z.number().positive(),
          warningThreshold: z.number().positive().max(1).optional(),
        }),
      );
      if (!parsed.success) return apiError(c, 400, "INVALID_COST_POLICY", parsed.error.message);
      return c.json({ policy: upsertCostPolicy(db, parsed.data) }, 201);
    },
  );
  app.post(
    "/api/governance/costs/reconcile",
    permission({ action: ACTIONS.COST_RECONCILE, resource: { kind: "cost-policy" } }),
    async (c) => {
      const parsed = await body(
        c,
        z.object({
          providerId: z.string().min(1),
          periodStart: z.iso.datetime(),
          periodEnd: z.iso.datetime(),
          billedUsd: z.number().nonnegative(),
          sourceRef: z.string().optional(),
        }),
      );
      if (!parsed.success) return apiError(c, 400, "INVALID_RECONCILIATION", parsed.error.message);
      return c.json(
        reconcileProviderBilling(db, { ...parsed.data, importedByUserId: userId(c) }),
        201,
      );
    },
  );
}

function registerInstanceGovernanceRoutes(app: Hono, deps: RouteDeps): void {
  registerBusinessTaskRoutes(app, deps);
  registerArtifactGovernanceRoutes(app, deps);
  registerWorkflowGovernanceRoutes(app, deps);
  registerAgentVersionRoutes(app, deps);
  registerAgentReviewRoutes(app, deps);
  registerInstanceAnalyticsRoutes(app, deps);
}

function registerBusinessTaskRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;
  const taskPermission = (action: string) =>
    permission({
      action,
      resource: { kind: "business-task", id: idResource },
      attributes: slugAttr,
    });
  app.get(
    "/api/instances/:slug/business-tasks",
    permission({
      action: ACTIONS.BUSINESS_TASK_LIST,
      resource: { kind: "business-task" },
      attributes: slugAttr,
    }),
    (c) =>
      c.json({
        tasks: listBusinessTasks(db, c.req.param("slug"), {
          teamId: c.req.query("teamId"),
          origin: c.req.query("origin") as never,
          reviewStatus: c.req.query("reviewStatus") as never,
        }),
      }),
  );
  app.post(
    "/api/instances/:slug/business-tasks",
    permission({
      action: ACTIONS.BUSINESS_TASK_CREATE,
      resource: { kind: "business-task" },
      attributes: slugAttr,
    }),
    async (c) => {
      const parsed = await body(c, BusinessTaskSchema);
      if (!parsed.success) return apiError(c, 400, "INVALID_BUSINESS_TASK", parsed.error.message);
      return c.json(
        {
          task: createBusinessTask(db, {
            instanceSlug: c.req.param("slug"),
            ...parsed.data,
            initiatorUserId: parsed.data.initiatorUserId ?? userId(c),
          }),
        },
        201,
      );
    },
  );
  app.get(
    "/api/instances/:slug/business-tasks/:id",
    taskPermission(ACTIONS.BUSINESS_TASK_READ),
    (c) => {
      const task = getBusinessTask(db, c.req.param("id"));
      return task?.instance_slug === c.req.param("slug")
        ? c.json({ task })
        : apiError(c, 404, "BUSINESS_TASK_NOT_FOUND", "Business task not found");
    },
  );
  app.post(
    "/api/instances/:slug/business-tasks/:id/complete",
    taskPermission(ACTIONS.BUSINESS_TASK_UPDATE),
    async (c) => {
      const parsed = await body(c, z.object({ outcome: z.string().max(2000).optional() }));
      if (!parsed.success) return apiError(c, 400, "INVALID_OUTCOME", parsed.error.message);
      const task = getBusinessTask(db, c.req.param("id"));
      if (!task || task.instance_slug !== c.req.param("slug"))
        return apiError(c, 404, "BUSINESS_TASK_NOT_FOUND", "Business task not found");
      return c.json({ task: completeBusinessTask(db, task.id, parsed.data.outcome) });
    },
  );
  app.post(
    "/api/instances/:slug/business-tasks/:id/reviews",
    taskPermission(ACTIONS.BUSINESS_TASK_REVIEW),
    async (c) => {
      const parsed = await body(c, ReviewSchema);
      if (!parsed.success) return apiError(c, 400, "INVALID_REVIEW", parsed.error.message);
      const task = getBusinessTask(db, c.req.param("id"));
      if (!task || task.instance_slug !== c.req.param("slug"))
        return apiError(c, 404, "BUSINESS_TASK_NOT_FOUND", "Business task not found");
      return c.json({
        task: reviewBusinessTask(db, task.id, {
          ...parsed.data,
          reviewerUserId: parsed.data.reviewerUserId ?? userId(c),
        }),
      });
    },
  );
}

function registerArtifactGovernanceRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;
  app.get(
    "/api/instances/:slug/artifacts",
    permission({
      action: ACTIONS.ARTIFACT_LIST,
      resource: { kind: "artifact" },
      attributes: slugAttr,
    }),
    (c) =>
      c.json({
        artifacts: listArtifacts(db, c.req.param("slug"), {
          businessTaskId: c.req.query("businessTaskId"),
          teamId: c.req.query("teamId"),
          state: c.req.query("state") as never,
        }),
      }),
  );
  app.post(
    "/api/instances/:slug/artifacts",
    permission({
      action: ACTIONS.ARTIFACT_CREATE,
      resource: { kind: "artifact" },
      attributes: slugAttr,
    }),
    async (c) => {
      const parsed = await body(c, ArtifactSchema);
      if (!parsed.success) return apiError(c, 400, "INVALID_ARTIFACT", parsed.error.message);
      return c.json(
        {
          artifact: createArtifact(db, {
            instanceSlug: c.req.param("slug"),
            ...parsed.data,
            ownerUserId: parsed.data.ownerUserId ?? userId(c),
          }),
        },
        201,
      );
    },
  );
  app.put(
    "/api/instances/:slug/artifacts/:id/state",
    permission({
      action: ACTIONS.ARTIFACT_TRANSITION,
      resource: { kind: "artifact", id: idResource },
      attributes: slugAttr,
    }),
    async (c) => {
      const parsed = await body(
        c,
        z.object({ state: z.enum(ARTIFACT_STATES), supersededById: z.string().uuid().optional() }),
      );
      if (!parsed.success) return apiError(c, 400, "INVALID_ARTIFACT_STATE", parsed.error.message);
      const artifact = getArtifact(db, c.req.param("id"));
      if (!artifact || artifact.instance_slug !== c.req.param("slug"))
        return apiError(c, 404, "ARTIFACT_NOT_FOUND", "Artifact not found");
      try {
        return c.json({
          artifact: transitionArtifact(
            db,
            artifact.id,
            parsed.data.state,
            parsed.data.supersededById,
          ),
        });
      } catch (error) {
        return apiError(c, 409, "INVALID_ARTIFACT_TRANSITION", String(error));
      }
    },
  );
}

function registerWorkflowGovernanceRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;
  app.post(
    "/api/instances/:slug/flows/:id/validate",
    permission({
      action: ACTIONS.WORKFLOW_VALIDATE,
      resource: { kind: "flow", id: idResource },
      attributes: slugAttr,
    }),
    (c) => {
      const report = validateWorkflow(db, Number(c.req.param("id")), userId(c));
      return report ? c.json({ report }) : apiError(c, 404, "FLOW_NOT_FOUND", "Flow not found");
    },
  );
  app.put(
    "/api/instances/:slug/flows/:id/lifecycle",
    permission({
      action: ACTIONS.WORKFLOW_LIFECYCLE,
      resource: { kind: "flow", id: idResource },
      attributes: slugAttr,
    }),
    async (c) => {
      const parsed = await body(
        c,
        z.object({
          lifecycle: z.enum(["DRAFT", "TESTING", "VALIDATED", "ACTIVE", "PAUSED", "ARCHIVED"]),
          reason: z.string().max(2000).optional(),
        }),
      );
      if (!parsed.success) return apiError(c, 400, "INVALID_LIFECYCLE", parsed.error.message);
      try {
        const flow = transitionWorkflow(
          db,
          Number(c.req.param("id")),
          parsed.data.lifecycle,
          userId(c),
          parsed.data.reason,
        );
        return flow ? c.json({ flow }) : apiError(c, 404, "FLOW_NOT_FOUND", "Flow not found");
      } catch (error) {
        return apiError(c, 409, "INVALID_LIFECYCLE_TRANSITION", String(error));
      }
    },
  );
}

function registerAgentVersionRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;
  app.post(
    "/api/instances/:slug/agents/:id/versions",
    permission({
      action: ACTIONS.AGENT_VERSION,
      resource: { kind: "agent", id: idResource },
      attributes: slugAttr,
    }),
    async (c) => {
      const parsed = await body(
        c,
        z.object({ config: z.record(z.string(), z.unknown()).optional() }),
      );
      if (!parsed.success) return apiError(c, 400, "INVALID_AGENT_VERSION", parsed.error.message);
      const version = parsed.data.config
        ? createAgentVersion(
            db,
            c.req.param("slug"),
            c.req.param("id"),
            parsed.data.config,
            userId(c),
          )
        : snapshotAgentVersion(db, c.req.param("slug"), c.req.param("id"), userId(c));
      return version
        ? c.json({ version }, 201)
        : apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");
    },
  );
}

function registerAgentReviewRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;
  app.post(
    "/api/instances/:slug/agents/:id/promotions",
    permission({
      action: ACTIONS.AGENT_PROMOTE,
      resource: { kind: "agent", id: idResource },
      attributes: slugAttr,
    }),
    async (c) => {
      const parsed = await body(
        c,
        z.object({
          toState: z.enum([
            "EXPERIMENTAL",
            "DEVELOPMENT",
            "TESTING",
            "PRODUCTION",
            "DEPRECATED",
            "ARCHIVED",
          ]),
          reason: z.string().max(2000).optional(),
        }),
      );
      if (!parsed.success) return apiError(c, 400, "INVALID_PROMOTION", parsed.error.message);
      try {
        return c.json(
          {
            approvalId: requestAgentPromotion(db, {
              instanceSlug: c.req.param("slug"),
              agentId: c.req.param("id"),
              requestedByUserId: userId(c),
              ...parsed.data,
            }),
          },
          201,
        );
      } catch (error) {
        return apiError(c, 404, "AGENT_NOT_FOUND", String(error));
      }
    },
  );
  app.post(
    "/api/instances/:slug/agent-promotions/:id/decision",
    permission({
      action: ACTIONS.AGENT_PROMOTE,
      resource: { kind: "agent-promotion", id: idResource },
      attributes: slugAttr,
    }),
    async (c) => {
      const parsed = await body(
        c,
        z.object({ approved: z.boolean(), reason: z.string().max(2000).optional() }),
      );
      const actor = userId(c);
      if (!parsed.success || !actor)
        return apiError(
          c,
          400,
          "INVALID_DECISION",
          parsed.success ? "A persisted user must decide promotions" : parsed.error.message,
        );
      return decideAgentPromotion(
        db,
        Number(c.req.param("id")),
        parsed.data.approved,
        actor,
        parsed.data.reason,
      )
        ? c.json({ ok: true })
        : apiError(c, 404, "APPROVAL_NOT_FOUND", "Pending approval not found");
    },
  );
  app.post(
    "/api/instances/:slug/agents/:id/rollback",
    permission({
      action: ACTIONS.AGENT_VERSION,
      resource: { kind: "agent", id: idResource },
      attributes: slugAttr,
    }),
    async (c) => {
      const parsed = await body(c, z.object({ version: z.number().int().positive() }));
      if (!parsed.success) return apiError(c, 400, "INVALID_ROLLBACK", parsed.error.message);
      const version = rollbackAgentVersion(
        db,
        c.req.param("slug"),
        c.req.param("id"),
        parsed.data.version,
        userId(c),
      );
      return version
        ? c.json({ version })
        : apiError(c, 404, "VERSION_NOT_FOUND", "Agent version not found");
    },
  );
  app.get(
    "/api/instances/:slug/agents/compare",
    permission({
      action: ACTIONS.AGENT_COMPARE,
      resource: { kind: "agent" },
      attributes: slugAttr,
    }),
    (c) => {
      const leftAgentId = c.req.query("left");
      const rightAgentId = c.req.query("right");
      if (!leftAgentId || !rightAgentId)
        return apiError(c, 400, "INVALID_COMPARISON", "left and right are required");
      const comparison = compareAgents(db, {
        instanceSlug: c.req.param("slug"),
        leftAgentId,
        rightAgentId,
      });
      return comparison
        ? c.json({ comparison })
        : apiError(c, 404, "AGENT_NOT_FOUND", "Agent not found");
    },
  );
  app.get(
    "/api/instances/:slug/agents/unused",
    permission({
      action: ACTIONS.AGENT_COMPARE,
      resource: { kind: "agent" },
      attributes: slugAttr,
    }),
    (c) =>
      c.json({
        agents: listUnusedAgents(db, c.req.param("slug"), Number(c.req.query("days") ?? 90)),
      }),
  );
}

function registerInstanceAnalyticsRoutes(app: Hono, deps: RouteDeps): void {
  const { db } = deps;
  app.get(
    "/api/instances/:slug/cost-governance",
    permission({
      action: ACTIONS.EXECUTION_ANALYTICS,
      resource: { kind: "cost-policy" },
      attributes: slugAttr,
    }),
    (c) => {
      const instance = db
        .prepare("SELECT team_id FROM instances WHERE slug = ?")
        .get(c.req.param("slug")) as { team_id: string | null };
      return c.json({
        policies: listApplicableCostPolicies(db, {
          teamId: instance.team_id ?? undefined,
          instanceSlug: c.req.param("slug"),
        }),
      });
    },
  );
  app.post(
    "/api/instances/:slug/cost-governance/detect-anomalies",
    permission({
      action: ACTIONS.COST_POLICY_MANAGE,
      resource: { kind: "cost-policy" },
      attributes: slugAttr,
    }),
    (c) => c.json({ detected: detectCostAnomalies(db) }),
  );
  app.get(
    "/api/instances/:slug/adoption",
    permission({
      action: ACTIONS.ADOPTION_ANALYTICS,
      resource: { kind: "adoption" },
      attributes: slugAttr,
    }),
    (c) => {
      const instance = db
        .prepare("SELECT team_id FROM instances WHERE slug = ?")
        .get(c.req.param("slug")) as { team_id: string | null };
      return c.json({
        metrics: getAdoptionMetrics(db, {
          startDate: c.req.query("startDate"),
          endDate: c.req.query("endDate"),
          teamId: c.req.query("teamId") ?? instance.team_id ?? undefined,
          useCaseId: c.req.query("useCaseId"),
          origin: c.req.query("origin") as never,
          outcome: c.req.query("outcome") as never,
        }),
      });
    },
  );
}
