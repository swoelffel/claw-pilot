// src/core/audit/sinks/file.ts
//
// Default Community sink: append each envelope as one JSON object per line
// in `<stateDir>/audit/YYYY-MM-DD.jsonl`. Daily rotation is computed from
// the envelope's timestamp (not wall-clock) so events near midnight land
// in the day they were emitted.
//
// `tail -f <stateDir>/audit/*.jsonl` is the intended ops interface.

import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import * as path from "node:path";
import type { AuditEventEnvelope } from "../events.js";
import { DEFAULT_SINK_BRAND, type AuditSink } from "../emitter.js";

export class FileAuditSink implements AuditSink {
  readonly kind = "file";
  readonly [DEFAULT_SINK_BRAND] = true;

  private readonly auditDir: string;

  constructor(stateDir: string) {
    this.auditDir = path.join(stateDir, "audit");
    mkdirSync(this.auditDir, { recursive: true, mode: 0o700 });
  }

  async write(envelope: AuditEventEnvelope): Promise<void> {
    const day = envelope.timestamp.slice(0, 10); // YYYY-MM-DD
    const file = path.join(this.auditDir, `${day}.jsonl`);
    await appendFile(file, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
  }
}
