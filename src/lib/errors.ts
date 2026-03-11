// src/lib/errors.ts

/**
 * Thrown inside withContext() callbacks to signal a CLI error.
 * Caught by the global handler in index.ts AFTER the DB is closed by withContext's finally block.
 * Never call process.exit() directly inside withContext — throw CliError instead.
 */
export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

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

export class GatewayUnhealthyError extends ClawPilotError {
  constructor(slug: string, port: number, detail?: string) {
    const base = `Gateway for "${slug}" not responding on port ${port}`;
    super(detail ? `${base} — ${detail}` : base, "GATEWAY_UNHEALTHY");
  }
}
