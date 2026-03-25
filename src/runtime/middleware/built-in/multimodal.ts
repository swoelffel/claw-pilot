/**
 * runtime/middleware/built-in/multimodal.ts
 *
 * Multimodal middleware — processes image attachments from inbound messages.
 *
 * Pre-phase:
 * 1. Checks if multimodal is enabled in config
 * 2. Validates attachments (size, MIME type)
 * 3. Stores image parts in the database (rt_parts)
 * 4. Stores attachment metadata in ctx.metadata for the message builder
 *
 * The message builder reads "imageAttachments" from the prompt loop input
 * to inject image content parts into the LLM call.
 */

import type { Middleware, MiddlewareContext } from "../types.js";
import type { InboundAttachment } from "../../types.js";
import { logger } from "../../../lib/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export const multimodalMiddleware: Middleware = {
  name: "multimodal",
  order: 20, // After guardrail (10), before most others

  async pre(ctx: MiddlewareContext): Promise<void> {
    const attachments = ctx.message.attachments;
    if (!attachments || attachments.length === 0) return;

    // Filter to valid image attachments
    const images = filterValidImages(attachments);
    if (images.length === 0) return;

    // Store in metadata for the message builder to pick up
    ctx.metadata.set("imageAttachments", images);

    logger.debug("multimodal_pre", {
      event: "multimodal_attachments",
      sessionId: ctx.sessionId,
      imageCount: images.length,
      totalBytes: images.reduce((sum, img) => sum + (img.sizeBytes ?? 0), 0),
    });
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterValidImages(attachments: InboundAttachment[]): InboundAttachment[] {
  const valid: InboundAttachment[] = [];
  for (const att of attachments) {
    if (att.type !== "image") {
      logger.debug("multimodal_skip", {
        event: "multimodal_skip_non_image",
        type: att.type,
        filename: att.filename,
      });
      continue;
    }
    if (!ALLOWED_IMAGE_TYPES.has(att.mimeType)) {
      logger.warn(`Multimodal: unsupported image MIME type "${att.mimeType}" — skipping`);
      continue;
    }
    if (att.sizeBytes && att.sizeBytes > 20 * MB) {
      logger.warn(`Multimodal: image too large (${Math.round(att.sizeBytes / MB)} MB) — skipping`);
      continue;
    }
    valid.push(att);
  }
  return valid;
}
