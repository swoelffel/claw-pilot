import { msg } from "@lit/localize";
import { ApiError } from "./api-error.js";

/**
 * Resolve an error to a user-facing localized message.
 * - ApiError: maps code -> i18n string
 * - Other errors: generic fallback
 */
export function userMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return resolveCode(err.code);
  }
  return msg("An unexpected error occurred.", { id: "err-unknown" });
}

function resolveCode(code: string): string {
  switch (code) {
    case "UNAUTHORIZED":
      return msg("Session expired. Please refresh the page.", { id: "err-unauthorized" });
    case "NOT_FOUND":
      return msg("Resource not found.", { id: "err-not-found" });
    case "INVALID_JSON":
      return msg("Invalid request format.", { id: "err-invalid-json" });
    case "INVALID_SLUG":
      return msg("Must be 2-30 lowercase letters, numbers, or hyphens.", { id: "err-invalid-slug" });
    case "SLUG_REQUIRED":
      return msg("This name is required.", { id: "err-slug-required" });
    case "SLUG_TAKEN":
      return msg("This name is already in use.", { id: "err-slug-taken" });
    case "FIELD_REQUIRED":
      return msg("A required field is missing.", { id: "err-field-required" });
    case "FIELD_INVALID":
      return msg("Invalid field value.", { id: "err-field-invalid" });
    case "FILE_NOT_EDITABLE":
      return msg("This file is read-only.", { id: "err-file-read-only" });
    case "FILE_NOT_FOUND":
      return msg("File not found.", { id: "err-file-not-found" });
    case "AGENT_NOT_FOUND":
      return msg("Agent not found.", { id: "err-agent-not-found" });
    case "PORT_CONFLICT":
      return msg("This port is already in use.", { id: "err-port-conflict" });
    case "SERVER_NOT_INIT":
      return msg("Server not initialized. Run claw-pilot init first.", { id: "err-server-not-init" });
    case "SYNC_FAILED":
      return msg("Agent sync failed. Check server logs.", { id: "err-sync-failed" });
    case "PROVISION_FAILED":
      return msg("Failed to create instance. Check server logs.", { id: "err-provision-failed" });
    case "LIFECYCLE_FAILED":
      return msg("Action failed. Check server logs.", { id: "err-lifecycle-failed" });
    case "DESTROY_FAILED":
      return msg("Failed to delete instance. Check server logs.", { id: "err-destroy-failed" });
    case "AGENT_CREATE_FAILED":
      return msg("Failed to create agent.", { id: "err-agent-create-failed" });
    case "AGENT_DELETE_FAILED":
      return msg("Failed to delete agent.", { id: "err-agent-delete-failed" });
    case "FILE_SAVE_FAILED":
      return msg("Failed to save file.", { id: "err-file-save-failed" });
    case "LINK_UPDATE_FAILED":
      return msg("Failed to update agent links.", { id: "err-link-update-failed" });
    default:
      return msg("An unexpected error occurred.", { id: "err-unknown" });
  }
}
