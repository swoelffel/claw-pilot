/**
 * Structured error from the claw-pilot API.
 * Carries the HTTP status and a machine-readable error code
 * that the UI maps to a localized user message.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
