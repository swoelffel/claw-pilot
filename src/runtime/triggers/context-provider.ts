// src/runtime/triggers/context-provider.ts
//
// Plugs the `"trigger"` provider into the flow-context-providers extension
// point (see `src/runtime/flow/context-providers.ts`).
//
// On every step briefing build the engine passes `runId` (the flow run id).
// We resolve it back to the originating `rt_flow_trigger_runs` row — if any
// — and expose its parsed payload + the result of `applyInputMapping`
// against the trigger's `input_mapping`. Steps can then template
// `{{trigger.payload.foo}}` or `{{trigger.mapped.pr_number}}`.
//
// Lookups are synchronous (better-sqlite3) and best-effort: any error is
// logged at warn level and the provider returns `{}` so the briefing build
// is never aborted by a flaky trigger lookup.

import type Database from "better-sqlite3";
import { registerFlowContextProvider } from "../flow/context-providers.js";
import { applyInputMapping, type InputMappingEntry } from "./jsonpath-mapper.js";
import { logger } from "../../lib/logger.js";

interface JoinedRow {
  payload: string | null;
  fired_at: string;
  kind: "cron" | "webhook";
  input_mapping: string | null;
}

/**
 * Register the `"trigger"` flow-context provider against `db`. Idempotent —
 * subsequent calls replace the prior registration with one bound to the
 * latest db handle (matters for test harnesses that rebuild the database).
 */
export function registerTriggerContextProvider(db: Database.Database): void {
  registerFlowContextProvider("trigger", (args) => {
    try {
      const row = db
        .prepare(
          `SELECT r.payload, r.fired_at, t.kind, t.input_mapping
           FROM rt_flow_trigger_runs r
           JOIN rt_flow_triggers t ON t.id = r.trigger_id
           WHERE r.flow_run_id = ?
           ORDER BY r.id DESC
           LIMIT 1`,
        )
        .get(args.runId) as JoinedRow | undefined;

      if (!row) return {};

      const payload = parsePayload(row.payload);
      const mapping = parseMapping(row.input_mapping);
      const mapped = applyInputMapping(payload, mapping);

      return {
        kind: row.kind,
        firedAt: row.fired_at,
        payload,
        mapped,
      };
    } catch (err) {
      logger.warn("trigger_context_provider_failed", {
        event: "trigger_context_provider_failed",
        runId: args.runId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  });
}

function parsePayload(raw: string | null): unknown {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.debug("trigger_payload_not_json", { error: String(err) });
    return raw;
  }
}

function parseMapping(raw: string | null): InputMappingEntry[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (e): e is InputMappingEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as InputMappingEntry).from === "string" &&
        typeof (e as InputMappingEntry).to === "string",
    );
  } catch (err) {
    logger.warn("trigger_input_mapping_parse_failed", {
      event: "trigger_input_mapping_parse_failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
