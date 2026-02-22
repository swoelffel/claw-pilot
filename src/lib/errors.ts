// src/lib/errors.ts

export class ClawPilotError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "ClawPilotError";
  }
}

export class InstanceNotFoundError extends ClawPilotError {
  constructor(slug: string) {
    super(`Instance "${slug}" not found in registry`, "INSTANCE_NOT_FOUND");
  }
}

export class InstanceAlreadyExistsError extends ClawPilotError {
  constructor(slug: string) {
    super(`Instance "${slug}" already exists`, "INSTANCE_EXISTS");
  }
}

export class PortConflictError extends ClawPilotError {
  constructor(port: number) {
    super(
      port === -1
        ? "No free port available in the configured range"
        : `Port ${port} is already in use`,
      "PORT_CONFLICT",
    );
  }
}

export class OpenClawNotFoundError extends ClawPilotError {
  constructor() {
    super(
      "OpenClaw CLI not found. Install it first: https://docs.openclaw.ai",
      "OPENCLAW_NOT_FOUND",
    );
  }
}

export class GatewayUnhealthyError extends ClawPilotError {
  constructor(slug: string, port: number) {
    super(
      `Gateway for "${slug}" not responding on port ${port}`,
      "GATEWAY_UNHEALTHY",
    );
  }
}
