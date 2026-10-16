/** Isolated test daemon: real IPC, SQLite and flow engine; only model routing is substituted. */
import { initDatabase } from "../../db/schema.js";
import { Registry } from "../../core/registry.js";
import { RuntimeConfigSchema } from "../../runtime/config/index.js";
import { InternalApiServer } from "../../runtime/engine/internal-api.js";
import { ChannelRouter } from "../../runtime/channel/router.js";
import { startFlowRun } from "../../runtime/flow/engine.js";

const db = initDatabase(process.argv[2]!);
const slug = "webhook-ipc";
const ctx = {
  db,
  registry: new Registry(db),
  instanceSlug: slug,
  config: RuntimeConfigSchema.parse({ defaultModel: "test/model", agents: [] }),
  workDir: undefined,
};
ChannelRouter.route = async (input) => {
  process.send?.({ type: "briefing", text: input.message.text });
  await new Promise<void>((resolve) => process.once("message", () => resolve()));
  return {
    response: {
      channelType: "web",
      peerId: "flow-engine",
      text: "OUTCOME: success\nSUMMARY: verified\nKEY FINDINGS:\n- payload delivered",
    },
    sessionId: input.sessionId!,
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0,
    requestId: "fixture",
    traceId: "fixture",
    executionId: "fixture",
    resultMessageId: "fixture",
  };
};
const server = new InternalApiServer({
  db,
  slug,
  port: Number(process.argv[3]),
  token: "webhook-test-ipc",
  handlers: {
    handleChat: async () => {
      throw new Error("Not used in this fixture");
    },
    handleWake: () => {},
    handleAbort: () => false,
    handleQuestionAnswer: () => false,
    handleFlowRun: (flowId, body) =>
      startFlowRun(
        ctx,
        flowId,
        body.triggerType ?? "manual",
        body.triggerDetail,
        body.vars,
        body.triggerRunId,
      ),
  },
});
await server.start();
process.send?.({ type: "ready", port: server.boundPort });
process.on("disconnect", () => {
  void server.stop().then(() => {
    db.close();
    process.exit(0);
  });
});
