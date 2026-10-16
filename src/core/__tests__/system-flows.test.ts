import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "../../db/schema.js";
import { parseAndValidateTeam } from "../team-import.js";
import { systemToolsPlugin } from "../../runtime/plugin/system-tools/index.js";
import type { FlowStepDef } from "../../runtime/flow/types.js";
import { buildBriefing } from "../../runtime/flow/briefing.js";
import { _buildStepTemplateContext } from "../../runtime/flow/engine.js";
import {
  createFlowDefinition,
  createFlowRun,
  createStepRun,
  getReadySteps,
  updateStepRun,
} from "../repositories/flow-repository.js";
import {
  bootstrapTestRegistry,
  resetServerRegistry,
} from "../../server/__tests__/_helpers/with-registry.js";

interface BuiltinFlow {
  name: string;
  description: string;
  steps: FlowStepDef[];
  trigger: { type: "manual" };
}

const flows = JSON.parse(
  readFileSync(new URL("../../../templates/system/cp-system.flows.json", import.meta.url), "utf8"),
) as BuiltinFlow[];
const team = parseAndValidateTeam(
  readFileSync(new URL("../../../templates/system/cp-system.team.yaml", import.meta.url), "utf8"),
);
if (!team.success) throw new Error("Invalid system team fixture");
const agentIds = team.data.agents.map((agent) => agent.id);

describe("built-in system flows", () => {
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    db = initDatabase(":memory:");
    bootstrapTestRegistry(db);
  });

  afterEach(() => {
    resetServerRegistry();
    db.close();
  });

  for (const flow of flows) {
    it(`${flow.name} routes every step to an installed agent with the requested tools`, async () => {
      for (const step of flow.steps) {
        expect(agentIds, `${flow.name}/${step.id}: missing agent ${step.agentId}`).toContain(
          step.agentId,
        );
        const context = {
          db,
          instanceSlug: "cp-system",
          agentId: step.agentId,
          version: "test",
          workDir: "/tmp/system-flows-test",
        };
        const hooks = await systemToolsPlugin(context);
        const tools = (await hooks.tools?.(context)) ?? [];
        const toolIds = tools.map((tool) => tool.id);
        // Built-ins report or propose; only a later conversational request may mutate state.
        expect(toolIds).not.toContain("cp_create_instance");
        expect(toolIds).not.toContain("cp_update_instance_config");
        expect(toolIds).not.toContain("cp_start_instance");
        for (const [requestedTool] of step.prompt.matchAll(/\bcp_[a-z_]+\b/g)) {
          expect(toolIds, `${flow.name}/${step.id}: inaccessible ${requestedTool}`).toContain(
            requestedTool,
          );
        }
      }
    });

    it(`${flow.name} schedules every DAG step on an isolated database`, () => {
      const definition = createFlowDefinition(db, {
        instanceSlug: "cp-system",
        name: flow.name,
        stepsJson: JSON.stringify(flow.steps),
      });
      const run = createFlowRun(db, {
        flowId: definition.id,
        instanceSlug: "cp-system",
        triggerType: "manual",
      });
      for (const step of flow.steps) {
        createStepRun(db, { runId: run.id, stepId: step.id, agentId: step.agentId });
      }
      let completed = 0;
      while (completed < flow.steps.length) {
        const ready = getReadySteps(db, run.id, definition.steps_json);
        expect(ready.length, "DAG is blocked").toBeGreaterThan(0);
        for (const step of ready) {
          updateStepRun(db, step.id, {
            status: "completed",
            sitrepJson: JSON.stringify({ outcome: "success", summary: "Test", keyFindings: [] }),
          });
          completed++;
        }
      }
      expect(completed).toBe(flow.steps.length);
    });
  }

  it.each([
    ["Team Builder", "brief", "Build a support triage team"],
    ["Team Optimizer", "targetSlug", "support-triage"],
  ])("%s receives explicit run input in its root briefing", (name, key, value) => {
    const flow = flows.find((candidate) => candidate.name === name)!;
    const step = flow.steps[0]!;
    const definition = createFlowDefinition(db, {
      instanceSlug: "cp-system",
      name,
      stepsJson: JSON.stringify(flow.steps),
    });
    const run = createFlowRun(db, {
      flowId: definition.id,
      instanceSlug: "cp-system",
      triggerType: "manual",
      inputVarsJson: JSON.stringify({ [key]: value }),
    });
    const briefing = buildBriefing(db, {
      instanceSlug: "cp-system",
      agentId: step.agentId,
      flowName: name,
      step,
      depSitreps: [],
      flowContext: _buildStepTemplateContext(db, run.id, [], {}),
    });
    expect(briefing).toContain(value);
  });
});
