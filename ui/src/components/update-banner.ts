// ui/src/components/update-banner.ts
//
// Bandeau de mise à jour OpenClaw — wrapper autour de cp-update-banner-base.
// Émet cp-update-action (bubbles + composed) → capturé par cp-cluster-view.

import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { OpenClawUpdateStatus } from "../types.js";
import "./update-banner-base.js";

@localized()
@customElement("cp-update-banner")
export class UpdateBanner extends LitElement {
  @property({ attribute: false }) status: OpenClawUpdateStatus | null = null;

  override render() {
    return html`
      <cp-update-banner-base
        .status=${this.status}
        .productName=${"OpenClaw"}
        .buttonLabel=${msg("Update all instances")}
        .runningSubtitle=${msg("This may take up to 60 seconds")}
        .doneSubtitle=${msg("All instances restarted")}
        @cp-update-action=${(e: Event) => {
          // Re-émet avec le nom d'événement attendu par cp-cluster-view
          e.stopPropagation();
          this.dispatchEvent(
            new CustomEvent("cp-update-action", { bubbles: true, composed: true }),
          );
        }}
      ></cp-update-banner-base>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-update-banner": UpdateBanner;
  }
}
