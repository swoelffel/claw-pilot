// src/core/secrets.ts
import { randomBytes } from "node:crypto";

/** Generate a 48-char hex gateway auth token */
export function generateGatewayToken(): string {
  return randomBytes(24).toString("hex");
}

/** Generate a dashboard access token */
export function generateDashboardToken(): string {
  return randomBytes(32).toString("hex");
}
