// ui/src/lib/dialog-mixin.ts
//
// Mixin that adds accessibility features to dialog components:
// - role="dialog" + aria-modal="true" on the host element
// - Escape key closes the dialog
// - Focus trap: Tab cycles within the dialog
// - Focus restoration: returns focus to the previously focused element on close
//
// Usage:
//   class MyDialog extends DialogMixin(LitElement) { ... }
//   // The subclass must dispatch a "close-dialog" event to close itself.

import type { LitElement } from "lit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = object> = new (...args: any[]) => T;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function DialogMixin<T extends Constructor<LitElement>>(Base: T) {
  class DialogMixinClass extends Base {
    private _previousFocus: HTMLElement | null = null;

    override connectedCallback(): void {
      super.connectedCallback();
      // Set ARIA attributes on the host element
      this.setAttribute("role", "dialog");
      this.setAttribute("aria-modal", "true");
      // Save the currently focused element for restoration
      this._previousFocus = document.activeElement as HTMLElement | null;
      // Listen for keyboard events
      this.addEventListener("keydown", this._handleKeydown as EventListener);
      // Focus the first focusable element after render
      this.updateComplete.then(() => this._focusFirst());
    }

    override disconnectedCallback(): void {
      super.disconnectedCallback();
      this.removeEventListener("keydown", this._handleKeydown as EventListener);
      // Restore focus to the element that was focused before the dialog opened
      if (this._previousFocus && typeof this._previousFocus.focus === "function") {
        this._previousFocus.focus();
        this._previousFocus = null;
      }
    }

    private _handleKeydown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent("close-dialog", { bubbles: true, composed: true }));
        return;
      }
      if (e.key === "Tab") {
        this._trapFocus(e);
      }
    };

    /** Get all focusable elements within the shadow DOM. */
    private _getFocusableElements(): HTMLElement[] {
      const root = this.shadowRoot;
      if (!root) return [];
      return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    }

    /** Focus the first focusable element in the dialog. */
    private _focusFirst(): void {
      const elements = this._getFocusableElements();
      if (elements.length > 0) {
        elements[0]!.focus();
      }
    }

    /** Trap Tab/Shift+Tab within the dialog's focusable elements. */
    private _trapFocus(e: KeyboardEvent): void {
      const elements = this._getFocusableElements();
      if (elements.length === 0) return;

      const first = elements[0]!;
      const last = elements[elements.length - 1]!;

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (this.shadowRoot?.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (this.shadowRoot?.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  return DialogMixinClass as unknown as T;
}
