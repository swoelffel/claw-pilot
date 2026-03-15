/**
 * runtime/engine/plugin-wiring.ts
 *
 * Connects bus events to plugin hook triggers.
 *
 * The bus delivers typed events synchronously; plugin hooks are async.
 * We bridge them by subscribing to bus events and firing the corresponding
 * plugin hook in a fire-and-forget manner (errors are caught and logged).
 *
 * Returns an array of unsubscribe functions so the engine can clean up on stop().
 */

import type { InstanceSlug } from "../types.js";
import { getBus } from "../bus/index.js";
import {
  MessageCreated,
  SessionCreated,
  SessionEnded,
  SessionStatusChanged,
} from "../bus/events.js";
import {
  triggerMessageReceived,
  triggerSessionStart,
  triggerSessionEnd,
  triggerAgentBeforeStart,
  triggerAgentEnd,
} from "../plugin/hooks.js";

// ---------------------------------------------------------------------------
// wirePluginsToBus
// ---------------------------------------------------------------------------

/**
 * Subscribe to bus events and forward them to plugin hooks.
 *
 * @returns Array of unsubscribe functions — call all of them on stop().
 */
export function wirePluginsToBus(instanceSlug: InstanceSlug): Array<() => void> {
  const bus = getBus(instanceSlug);
  const unsubs: Array<() => void> = [];

  // message.created → plugin "message.received"
  unsubs.push(
    bus.subscribe(MessageCreated, (payload) => {
      if (payload.role !== "user") return; // only user messages trigger "received"
      void triggerMessageReceived({
        instanceSlug,
        sessionId: payload.sessionId,
        messageId: payload.messageId,
        role: payload.role,
        text: "", // text not available in the event payload — plugins can query DB if needed
      }).catch((err) => {
        console.warn("[claw-runtime] plugin hook message.received threw:", err);
      });
    }),
  );

  // session.created → plugin "session.start"
  unsubs.push(
    bus.subscribe(SessionCreated, (payload) => {
      void triggerSessionStart({
        instanceSlug,
        sessionId: payload.sessionId,
      }).catch((err) => {
        console.warn("[claw-runtime] plugin hook session.start threw:", err);
      });
    }),
  );

  // session.ended → plugin "session.end"
  unsubs.push(
    bus.subscribe(SessionEnded, (payload) => {
      void triggerSessionEnd({
        instanceSlug,
        sessionId: payload.sessionId,
      }).catch((err) => {
        console.warn("[claw-runtime] plugin hook session.end threw:", err);
      });
    }),
  );

  // session.status "busy" → plugin "agent.beforeStart"
  // session.status "idle" → plugin "agent.end"
  unsubs.push(
    bus.subscribe(SessionStatusChanged, (payload) => {
      if (payload.status === "busy") {
        void triggerAgentBeforeStart({
          instanceSlug,
          sessionId: payload.sessionId,
          agentName: payload.agentId ?? "",
          model: "",
        }).catch((err) => {
          console.warn("[claw-runtime] plugin hook agent.beforeStart threw:", err);
        });
      }
      if (payload.status === "idle") {
        void triggerAgentEnd({
          instanceSlug,
          sessionId: payload.sessionId,
          agentName: payload.agentId ?? "",
          tokensIn: payload.tokensIn ?? 0,
          tokensOut: payload.tokensOut ?? 0,
          costUsd: payload.costUsd ?? 0,
        }).catch((err) => {
          console.warn("[claw-runtime] plugin hook agent.end threw:", err);
        });
      }
    }),
  );

  return unsubs;
}
