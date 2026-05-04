// ui/src/components/triggers/cp-cron-picker.ts
//
// Visual cron picker with two modes: "interval" (per-unit conditional fields)
// and "expression" (raw cron string with live validation + next-runs preview).
//
// The compilation logic is exposed as a pure function `compileCron()` so it
// can be unit-tested without a DOM environment.

import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";
import { Cron } from "croner";
import { tokenStyles } from "../../styles/tokens.js";
import { buttonStyles } from "../../styles/shared.js";

// ---------------------------------------------------------------------------
// Pure compilation helpers
// ---------------------------------------------------------------------------

/** Interval unit selected in the visual picker. */
export type CronIntervalUnit = "minute" | "hour" | "day" | "week" | "month";

/** Day of week (1 = Monday .. 7 = Sunday), matching the spec's CSV format. */
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Structured "Set Interval" state. */
export interface CronIntervalState {
  unit: CronIntervalUnit;
  /** Repeat every N. Bounded 1..99. Locked to 1 for "week". */
  every: number;
  /** Minute offset (0..59) — used by "hour". */
  minute: number;
  /** Hour-of-day (0..23) — used by "day", "week", "month". */
  hour: number;
  /** Days of week selected (multi-select) — used by "week". */
  days: DayOfWeek[];
  /** Days of month selected (1..31) — used by "month". */
  daysOfMonth: number[];
}

/** Result of compiling an interval state to a canonical cron expression. */
export interface CompiledCron {
  /** 5-field cron expression (minute hour dom month dow). */
  cron: string;
  /** Human-readable summary of the schedule (English). */
  humanReadable: string;
}

const DOW_NAMES = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const DOW_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Compile a structured "Set Interval" state to a canonical 5-field cron
 * expression and a human-readable summary string.
 *
 * Compilation rules (from screen-triggers.md):
 * - Minute(s):  `*\/N * * * *`
 * - Hour(s) at :MM:  `MM *\/N * * *`
 * - Day(s) at HH:MM:  `MM HH *\/N * *` (N=1 → `MM HH * * *`)
 * - Week on DOW-csv at HH:MM:  `MM HH * * <csv>` (DOW: 1=Mon..7=Sun, locked to N=1)
 * - Month(s) on DOM-csv at HH:MM:  `MM HH <csv> *\/N *`
 */
export function compileCron(state: CronIntervalState): CompiledCron {
  const every = Math.max(1, Math.min(99, Math.floor(state.every) || 1));
  const minute = Math.max(0, Math.min(59, Math.floor(state.minute) || 0));
  const hour = Math.max(0, Math.min(23, Math.floor(state.hour) || 0));

  switch (state.unit) {
    case "minute": {
      const cron = `*/${every} * * * *`;
      const human = every === 1 ? "Runs every minute" : `Runs every ${every} minutes`;
      return { cron, humanReadable: human };
    }
    case "hour": {
      const cron = every === 1 ? `${minute} * * * *` : `${minute} */${every} * * *`;
      const human =
        every === 1
          ? `Runs every hour at minute :${pad2(minute)}`
          : `Runs every ${every} hours at minute :${pad2(minute)}`;
      return { cron, humanReadable: human };
    }
    case "day": {
      const cron = every === 1 ? `${minute} ${hour} * * *` : `${minute} ${hour} */${every} * *`;
      const human =
        every === 1
          ? `Runs every day at ${pad2(hour)}:${pad2(minute)}`
          : `Runs every ${every} days at ${pad2(hour)}:${pad2(minute)}`;
      return { cron, humanReadable: human };
    }
    case "week": {
      // Standard cron cannot express "every N weeks" — N is locked to 1.
      const days = state.days.length > 0 ? [...state.days].sort((a, b) => a - b) : [1];
      const csv = days.join(",");
      const cron = `${minute} ${hour} * * ${csv}`;
      const human = `Runs every ${joinList(days.map((d) => DOW_NAMES[d]!))} at ${pad2(hour)}:${pad2(minute)}`;
      return { cron, humanReadable: human };
    }
    case "month": {
      const dom = state.daysOfMonth.length > 0 ? [...state.daysOfMonth].sort((a, b) => a - b) : [1];
      const csv = dom.join(",");
      const cron =
        every === 1 ? `${minute} ${hour} ${csv} * *` : `${minute} ${hour} ${csv} */${every} *`;
      const ordinal = (n: number): string => `${n}`;
      const human =
        every === 1
          ? `Runs every month on day ${joinList(dom.map(ordinal))} at ${pad2(hour)}:${pad2(minute)}`
          : `Runs every ${every} months on day ${joinList(dom.map(ordinal))} at ${pad2(hour)}:${pad2(minute)}`;
      return { cron, humanReadable: human };
    }
  }
}

/** Default starting interval state for a freshly opened picker. */
export function defaultIntervalState(): CronIntervalState {
  return {
    unit: "day",
    every: 1,
    minute: 0,
    hour: 9,
    days: [1],
    daysOfMonth: [1],
  };
}

// ---------------------------------------------------------------------------
// parseCron — round-trip from a stored cron expression to interval state.
// ---------------------------------------------------------------------------

/** Result of parsing a cron expression back into an interval state. */
export interface ParsedCron {
  /** Recovered interval state, or null when the expression cannot be reduced. */
  state: CronIntervalState | null;
  /** Picker mode to fall back on. */
  fallbackMode: "interval" | "expression";
}

/** Internal: parse a positive integer from a string, return null on failure. */
function _parseInt(s: string): number | null {
  if (!/^\d+$/.test(s)) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/** Internal: parse a `*\/N` or `*` field into a step (0 means "every"). */
function _parseStep(field: string): number | null {
  if (field === "*") return 1;
  const m = /^\*\/(\d+)$/.exec(field);
  if (!m) return null;
  const n = _parseInt(m[1]!);
  return n !== null && n >= 1 ? n : null;
}

/** Internal: parse a CSV of integers (each in `min..max`), return sorted unique list or null. */
function _parseCsvInts(field: string, min: number, max: number): number[] | null {
  if (field.includes("-") || field.includes("/")) return null;
  const parts = field.split(",");
  const out: number[] = [];
  for (const p of parts) {
    const n = _parseInt(p);
    if (n === null || n < min || n > max) return null;
    if (!out.includes(n)) out.push(n);
  }
  if (out.length === 0) return null;
  out.sort((a, b) => a - b);
  return out;
}

const FALLBACK = (): ParsedCron => ({ state: null, fallbackMode: "expression" });

/**
 * Parse a 5-field cron expression back into a structured interval state.
 *
 * Mirrors `compileCron` exactly. Anything that doesn't match one of the
 * canonical patterns falls back to `{ state: null, fallbackMode: "expression" }`.
 */
export function parseCron(expr: string): ParsedCron {
  const trimmed = (expr ?? "").trim();
  if (!trimmed) return FALLBACK();
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return FALLBACK();
  const [m, h, dom, mon, dow] = fields as [string, string, string, string, string];

  // Reject named months / weekdays, ranges, ? characters, and complex compounds.
  if (/[a-zA-Z?]/.test(trimmed)) return FALLBACK();

  const defaults = defaultIntervalState();

  // ---- Minute(s): "*\/N * * * *" --------------------------------------------
  // Only matches when minute is itself a step (e.g. "*/5") and everything
  // else is "*". A literal-minute "0 * * * *" falls through to Hour(s).
  if (mon === "*" && dom === "*" && dow === "*" && h === "*" && m.startsWith("*/")) {
    const step = _parseStep(m);
    if (step !== null) {
      return {
        state: { ...defaults, unit: "minute", every: step },
        fallbackMode: "interval",
      };
    }
    return FALLBACK();
  }

  // From here, minute must be a literal int (0..59).
  const minute = _parseInt(m);
  if (minute === null || minute < 0 || minute > 59) return FALLBACK();

  // ---- Hour(s): "MM * * * *" or "MM *\/N * * *" -----------------------------
  // Only matches when hour is "*" or "*/N". A literal-hour "MM HH * * *"
  // falls through to Day(s).
  if (dom === "*" && mon === "*" && dow === "*" && (h === "*" || h.startsWith("*/"))) {
    const step = _parseStep(h);
    if (step !== null) {
      const every = h === "*" ? 1 : step;
      return {
        state: { ...defaults, unit: "hour", every, minute },
        fallbackMode: "interval",
      };
    }
    return FALLBACK();
  }

  // From here, hour must be a literal int (0..23).
  const hour = _parseInt(h);
  if (hour === null || hour < 0 || hour > 23) return FALLBACK();

  // ---- Week: "MM HH * * <DOW-csv>" -----------------------------------------
  if (dom === "*" && mon === "*" && dow !== "*") {
    const days = _parseCsvInts(dow, 0, 7);
    if (days === null) return FALLBACK();
    // Normalize 0 (Sunday) → 7 to match compileCron's 1..7 range.
    const normalized: DayOfWeek[] = [];
    for (const d of days) {
      const v = d === 0 ? 7 : d;
      if (v < 1 || v > 7) return FALLBACK();
      if (!normalized.includes(v as DayOfWeek)) normalized.push(v as DayOfWeek);
    }
    normalized.sort((a, b) => a - b);
    return {
      state: { ...defaults, unit: "week", every: 1, days: normalized, hour, minute },
      fallbackMode: "interval",
    };
  }

  // ---- Day(s) every 1: "MM HH * * *" ---------------------------------------
  if (dom === "*" && mon === "*" && dow === "*") {
    return {
      state: { ...defaults, unit: "day", every: 1, hour, minute },
      fallbackMode: "interval",
    };
  }

  // ---- Day(s) every N: "MM HH *\/N * *" or Month/1 "MM HH <DOM-csv> * *" ---
  if (dom !== "*" && mon === "*" && dow === "*") {
    // First try Day(s) — dom is "*/N" (or "*", though compileCron emits "*"
    // only when N=1 via the explicit branch).
    const step = _parseStep(dom);
    if (step !== null) {
      const every = dom === "*" ? 1 : step;
      return {
        state: { ...defaults, unit: "day", every, hour, minute },
        fallbackMode: "interval",
      };
    }
    // Otherwise it's Month with mon="*" and N=1: "MM HH <DOM-csv> * *".
    const doms = _parseCsvInts(dom, 1, 31);
    if (doms === null) return FALLBACK();
    return {
      state: {
        ...defaults,
        unit: "month",
        every: 1,
        daysOfMonth: doms,
        hour,
        minute,
      },
      fallbackMode: "interval",
    };
  }

  // ---- Month(s): "MM HH <DOM-csv> *\/N *" ----------------------------------
  if (dow === "*" && dom !== "*" && mon !== "*") {
    const step = _parseStep(mon);
    if (step === null) return FALLBACK();
    const every = mon === "*" ? 1 : step;
    const doms = _parseCsvInts(dom, 1, 31);
    if (doms === null) return FALLBACK();
    return {
      state: {
        ...defaults,
        unit: "month",
        every,
        daysOfMonth: doms,
        hour,
        minute,
      },
      fallbackMode: "interval",
    };
  }

  return FALLBACK();
}

// ---------------------------------------------------------------------------
// Lit element
// ---------------------------------------------------------------------------

/**
 * `<cp-cron-picker>` — visual cron picker.
 *
 * Properties:
 * - `value` (string): current cron expression (two-way bound).
 * - `timezone` (string): IANA timezone for the "Next 3 runs" preview.
 *
 * Emits `change` with detail `{ cron: string, humanReadable: string }`
 * whenever the underlying cron expression changes.
 */
@localized()
@customElement("cp-cron-picker")
export class CpCronPicker extends LitElement {
  static override styles = [
    tokenStyles,
    buttonStyles,
    css`
      :host {
        display: block;
        font-family: var(--font-ui);
      }
      .mode-switch {
        display: flex;
        gap: 16px;
        margin-bottom: 12px;
      }
      .mode-switch label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        font-size: 13px;
      }
      .row {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 8px;
        flex-wrap: wrap;
      }
      input,
      select {
        padding: 4px 6px;
        background: var(--bg-base);
        color: var(--text-primary);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        font-family: var(--font-ui);
        font-size: 13px;
      }
      input[type="text"] {
        width: 100%;
        box-sizing: border-box;
      }
      input.num {
        width: 60px;
      }
      .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 6px;
      }
      .chip {
        padding: 4px 10px;
        border: 1px solid var(--bg-border);
        border-radius: 14px;
        background: var(--bg-hover);
        color: var(--text-primary);
        cursor: pointer;
        font-size: 12px;
        user-select: none;
      }
      .chip.active {
        background: var(--accent);
        color: #fff;
        border-color: var(--accent);
      }
      .dom-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 4px;
        margin-top: 6px;
      }
      .dom-cell {
        text-align: center;
        padding: 4px 0;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-sm);
        background: var(--bg-hover);
        cursor: pointer;
        font-size: 12px;
        user-select: none;
      }
      .dom-cell.active {
        background: var(--accent);
        color: #fff;
        border-color: var(--accent);
      }
      .dom-cell .flag {
        color: var(--state-warning);
      }
      .preview-runs {
        margin-top: 10px;
        padding: 8px;
        background: var(--bg-base);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-secondary);
      }
      .invalid {
        color: var(--state-error);
        font-size: 12px;
        margin-top: 4px;
      }
      .locked-note {
        font-size: 11px;
        color: var(--text-secondary);
      }
    `,
  ];

  @property({ type: String }) value = "0 9 * * *";
  @property({ type: String }) timezone = "Europe/Paris";
  /**
   * Optional pre-existing cron expression for edit mode. When set on first
   * render, the picker calls `parseCron` to hydrate either the visual interval
   * state or the raw expression draft. After hydration, the picker emits a
   * `change` event with the canonical compiled value so the host sees a
   * populated value immediately.
   */
  @property({ type: String }) initialValue: string | undefined = undefined;

  @state() private _mode: "interval" | "expression" = "interval";
  @state() private _interval: CronIntervalState = defaultIntervalState();
  @state() private _exprDraft = "";
  @state() private _exprError = "";
  private _hydrated = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this._hydrateFromInitialValue();
    this._exprDraft = this._exprDraft || this.value;
    this._emitChange();
  }

  /**
   * Apply `initialValue` (when provided) on first connection. Called once;
   * subsequent reconnections are no-ops to avoid clobbering user edits.
   */
  private _hydrateFromInitialValue(): void {
    if (this._hydrated) return;
    this._hydrated = true;
    const seed = this.initialValue;
    if (typeof seed !== "string" || seed.trim() === "") return;
    const parsed = parseCron(seed);
    if (parsed.state !== null) {
      this._mode = "interval";
      this._interval = parsed.state;
      this.value = compileCron(parsed.state).cron;
    } else {
      this._mode = "expression";
      this._exprDraft = seed;
      this.value = seed;
      this._validateExpr();
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private _emitChange(): void {
    let cron: string;
    let humanReadable: string;
    if (this._mode === "interval") {
      const result = compileCron(this._interval);
      cron = result.cron;
      humanReadable = result.humanReadable;
      this.value = cron;
    } else {
      cron = this._exprDraft.trim();
      humanReadable = `Custom cron: ${cron}`;
      this.value = cron;
    }
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { cron, humanReadable },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _updateInterval(patch: Partial<CronIntervalState>): void {
    this._interval = { ...this._interval, ...patch };
    this._emitChange();
  }

  private _setUnit(unit: CronIntervalUnit): void {
    // Lock "every" to 1 when switching to week (cron limitation).
    const every = unit === "week" ? 1 : this._interval.every;
    this._updateInterval({ unit, every });
  }

  private _setMode(mode: "interval" | "expression"): void {
    this._mode = mode;
    if (mode === "expression") {
      // Seed the expression draft from the currently-compiled value.
      this._exprDraft = compileCron(this._interval).cron;
      this._validateExpr();
    }
    this._emitChange();
  }

  private _toggleDay(d: DayOfWeek): void {
    const has = this._interval.days.includes(d);
    const next = has ? this._interval.days.filter((x) => x !== d) : [...this._interval.days, d];
    // At least one day must remain selected.
    if (next.length === 0) return;
    this._updateInterval({ days: next });
  }

  private _toggleDom(d: number): void {
    const has = this._interval.daysOfMonth.includes(d);
    const next = has
      ? this._interval.daysOfMonth.filter((x) => x !== d)
      : [...this._interval.daysOfMonth, d];
    if (next.length === 0) return;
    this._updateInterval({ daysOfMonth: next });
  }

  private _validateExpr(): void {
    const expr = this._exprDraft.trim();
    if (!expr) {
      this._exprError = "Cron expression cannot be empty";
      return;
    }
    try {
      // Paused dry-run — does not schedule, only validates parsing.
      new Cron(expr, { timezone: this.timezone, paused: true });
      this._exprError = "";
    } catch (err) {
      this._exprError = `Invalid cron expression: ${String(err instanceof Error ? err.message : err)}`;
    }
  }

  private _onExprInput(e: Event): void {
    this._exprDraft = (e.target as HTMLInputElement).value;
    this._validateExpr();
    this._emitChange();
  }

  private _nextRuns(): string[] {
    const expr = this._mode === "expression" ? this._exprDraft.trim() : this.value;
    if (!expr) return [];
    try {
      const c = new Cron(expr, { timezone: this.timezone, paused: true });
      const runs = c.nextRuns(3);
      return runs.map((d) => {
        // Format: YYYY-MM-DD HH:MM:SS <tz>
        const iso = d.toISOString().replace("T", " ").slice(0, 19);
        return `${iso} ${this.timezone}`;
      });
    } catch (err) {
      void err;
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Renders
  // -------------------------------------------------------------------------

  private _renderEveryRow() {
    const { unit, every } = this._interval;
    const lockedToOne = unit === "week";
    return html`
      <div class="row">
        <span>${msg("Repeat Every", { id: "cron-picker-repeat-every" })}</span>
        <input
          class="num"
          type="number"
          min="1"
          max="99"
          .value=${String(every)}
          ?disabled=${lockedToOne}
          title=${lockedToOne
            ? msg("Standard cron cannot express 'every N weeks'. Locked to 1.", {
                id: "cron-picker-week-lock-tooltip",
              })
            : ""}
          @input=${(e: Event) =>
            this._updateInterval({ every: Number((e.target as HTMLInputElement).value) || 1 })}
        />
        <select
          .value=${unit}
          @change=${(e: Event) =>
            this._setUnit((e.target as HTMLSelectElement).value as CronIntervalUnit)}
        >
          <option value="minute">${msg("Minute(s)", { id: "cron-picker-unit-minute" })}</option>
          <option value="hour">${msg("Hour(s)", { id: "cron-picker-unit-hour" })}</option>
          <option value="day">${msg("Day(s)", { id: "cron-picker-unit-day" })}</option>
          <option value="week">${msg("Week(s)", { id: "cron-picker-unit-week" })}</option>
          <option value="month">${msg("Month(s)", { id: "cron-picker-unit-month" })}</option>
        </select>
        ${lockedToOne
          ? html`<span class="locked-note"
              >${msg("(locked: cron cannot express N weeks)", {
                id: "cron-picker-week-lock-note",
              })}</span
            >`
          : ""}
      </div>
    `;
  }

  private _renderHourBody() {
    return html`
      <div class="row">
        <span>${msg("At minute", { id: "cron-picker-at-minute" })}</span>
        <input
          class="num"
          type="number"
          min="0"
          max="59"
          .value=${String(this._interval.minute)}
          @input=${(e: Event) =>
            this._updateInterval({ minute: Number((e.target as HTMLInputElement).value) || 0 })}
        />
      </div>
    `;
  }

  private _renderTimeOfDay() {
    return html`
      <div class="row">
        <span>${msg("Execute at", { id: "cron-picker-execute-at" })}</span>
        <input
          class="num"
          type="number"
          min="0"
          max="23"
          .value=${String(this._interval.hour)}
          @input=${(e: Event) =>
            this._updateInterval({ hour: Number((e.target as HTMLInputElement).value) || 0 })}
        />
        <span>:</span>
        <input
          class="num"
          type="number"
          min="0"
          max="59"
          .value=${String(this._interval.minute)}
          @input=${(e: Event) =>
            this._updateInterval({ minute: Number((e.target as HTMLInputElement).value) || 0 })}
        />
      </div>
    `;
  }

  private _renderWeekBody() {
    return html`
      <div class="row">
        <span>${msg("Execute every week on:", { id: "cron-picker-execute-every-week" })}</span>
      </div>
      <div class="chip-row">
        ${([1, 2, 3, 4, 5, 6, 7] as DayOfWeek[]).map(
          (d) => html`
            <span
              class="chip ${this._interval.days.includes(d) ? "active" : ""}"
              @click=${() => this._toggleDay(d)}
            >
              ${DOW_SHORT[d]}
            </span>
          `,
        )}
      </div>
      ${this._renderTimeOfDay()}
    `;
  }

  private _renderMonthBody() {
    const cells: number[] = [];
    for (let i = 1; i <= 31; i += 1) cells.push(i);
    return html`
      <div class="row">
        <span>${msg("Execute every month on:", { id: "cron-picker-execute-every-month" })}</span>
      </div>
      <div class="dom-grid">
        ${cells.map(
          (d) => html`
            <span
              class="dom-cell ${this._interval.daysOfMonth.includes(d) ? "active" : ""}"
              title=${d >= 29
                ? msg("May skip in shorter months", { id: "cron-picker-dom-warn" })
                : ""}
              @click=${() => this._toggleDom(d)}
            >
              ${d}${d >= 29 ? html`<span class="flag">*</span>` : ""}
            </span>
          `,
        )}
      </div>
      ${this._renderTimeOfDay()}
    `;
  }

  private _renderIntervalBody() {
    switch (this._interval.unit) {
      case "minute":
        return html``;
      case "hour":
        return this._renderHourBody();
      case "day":
        return this._renderTimeOfDay();
      case "week":
        return this._renderWeekBody();
      case "month":
        return this._renderMonthBody();
    }
  }

  private _renderExpressionMode() {
    const runs = this._nextRuns();
    return html`
      <div class="row">
        <span>${msg("Cron expression", { id: "cron-picker-expr-label" })}</span>
        <input type="text" .value=${this._exprDraft} @input=${this._onExprInput} />
      </div>
      ${this._exprError
        ? html`<div class="invalid">${this._exprError}</div>`
        : html`<div class="locked-note">
            ${msg("Status: valid", { id: "cron-picker-status-valid" })}
          </div>`}
      ${runs.length > 0
        ? html`
            <div class="preview-runs">
              ${msg("Next 3 runs:", { id: "cron-picker-next-runs" })}
              ${runs.map((r) => html`<div>${r}</div>`)}
            </div>
          `
        : ""}
    `;
  }

  override render() {
    return html`
      <div class="mode-switch">
        <label>
          <input
            type="radio"
            name="cron-mode"
            .checked=${this._mode === "interval"}
            @change=${() => this._setMode("interval")}
          />
          ${msg("Set Interval", { id: "cron-picker-mode-interval" })}
        </label>
        <label>
          <input
            type="radio"
            name="cron-mode"
            .checked=${this._mode === "expression"}
            @change=${() => this._setMode("expression")}
          />
          ${msg("Cron Expression", { id: "cron-picker-mode-expression" })}
        </label>
      </div>
      ${this._mode === "interval"
        ? html`${this._renderEveryRow()} ${this._renderIntervalBody()}`
        : this._renderExpressionMode()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cp-cron-picker": CpCronPicker;
  }
}
