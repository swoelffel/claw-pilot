// ui/src/components/self-update-banner.ts
//
// Bandeau de mise à jour claw-pilot — wrapper autour de cp-update-banner-base.
// dismissable=true : un bouton × apparaît sur l'état done (sécurité si le
// location.reload() automatique n'arrive pas après le restart systemd).
//
// Émet cp-update-action (bubbles + composed) → capturé par cp-app.

import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import type { SelfUpdateStatus } from "../types.js";
import "./update-banner-base.js";

@localized()
@customElement("cp-self-update-banner")
export class SelfUpdateBanner extends LitElement {
  @property({ attribute: false }) status: SelfUpdateStatus | null = null;

  override render() {
    return html`
      <cp-update-banner-base
        .status=${this.status}
        .productName=${"claw-pilot"}
        .buttonLabel=${msg("Update claw-pilot")}
        .runningSubtitle=${msg("This may take several minutes (git + build)")}
        .doneSubtitle=${msg("Dashboard service restarted")}
        ?dismissable=${true}
        @cp-update-action=${(e: Event) => {
          // Re-émet avec le nom d'événement attendu par cp-app
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
    "cp-self-update-banner": SelfUpdateBanner;
  }
}
