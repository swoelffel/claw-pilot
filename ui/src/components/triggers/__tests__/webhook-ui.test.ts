// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { CpTriggerWizard } from "../cp-trigger-wizard.js";
import { CpTriggerDetail } from "../cp-trigger-detail.js";

interface WizardState {
  _kind: string;
  _step: number;
  _flowId: string;
  _name: string;
  _webhookSlug: string;
  _webhookSecret: string;
  _canAdvance(): boolean;
  render(): unknown;
}
interface DetailState {
  instanceSlug: string;
  triggerId: number;
  _tab: string;
  _detail: unknown;
  _onRevoke(): Promise<void>;
  render(): unknown;
}
function view(element: { render(): unknown }) {
  const host = document.createElement("div");
  render(element.render(), host);
  return host;
}
afterEach(() => vi.unstubAllGlobals());

describe("webhook setup", () => {
  it("lets the creator select a webhook and requires a masked initial secret", () => {
    const wizard = new CpTriggerWizard() as unknown as WizardState;
    const card = [...view(wizard).querySelectorAll(".kind-card")].find((el) =>
      el.textContent?.includes("Webhook"),
    ) as HTMLElement;
    card.click();
    expect(wizard._kind).toBe("webhook");
    expect(wizard._canAdvance()).toBe(true);
    wizard._step = 3;
    wizard._flowId = "1";
    wizard._name = "hook";
    wizard._webhookSlug = "valid-hook";
    let host = view(wizard);
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
    expect((host.querySelector(".footer-cluster .btn-primary") as HTMLButtonElement).disabled).toBe(
      true,
    );
    wizard._webhookSecret = "long-initial-secret-value";
    host = view(wizard);
    expect((host.querySelector(".footer-cluster .btn-primary") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
  it("hides stored secret actions from a manager without dedicated permissions", () => {
    const detail = new CpTriggerDetail() as unknown as DetailState;
    detail._tab = "test";
    detail._detail = {
      id: 1,
      instanceSlug: "demo",
      kind: "webhook",
      webhookSlug: "hook",
      signatureVersion: 2,
      secretPermissions: { reveal: false, rotate: false, revoke: false },
    };
    const host = view(detail);
    expect(host.textContent).not.toContain("Reveal secret");
    expect(host.textContent).not.toContain("Revoke secret");
    expect(host.textContent).toContain("X-ClawPilot-Timestamp");
    expect(host.textContent).toContain("Idempotency-Key");
  });
  it("lets an administrator revoke and displays the persistent revoked state", async () => {
    const detail = new CpTriggerDetail() as unknown as DetailState;
    const record = {
      id: 1,
      instanceSlug: "demo",
      kind: "webhook",
      webhookSlug: "hook",
      signatureVersion: 2,
      secretRevoked: false,
      runs: [],
      secretPermissions: { reveal: true, rotate: true, revoke: true },
    };
    detail.instanceSlug = "demo";
    detail.triggerId = 1;
    detail._detail = record;
    detail._tab = "test";
    vi.stubGlobal("confirm", () => true);
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${input}`);
      if (input.endsWith("/revoke-secret")) return Response.json({ revoked: true });
      return Response.json({ ...record, secretRevoked: true });
    });
    await detail._onRevoke();
    expect(calls[0]).toBe("POST /api/instances/demo/triggers/1/revoke-secret");
    expect(view(detail).textContent).toContain("Webhook secret revoked");
  });
});
