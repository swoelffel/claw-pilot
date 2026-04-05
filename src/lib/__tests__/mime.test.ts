/**
 * lib/__tests__/mime.test.ts
 *
 * Unit tests for MIME type resolution.
 * Pure function — no mocks needed.
 */

import { describe, it, expect } from "vitest";
import { mimeFromExtension } from "../mime.js";

describe("mimeFromExtension", () => {
  it("returns text/plain for .txt", () => {
    expect(mimeFromExtension(".txt")).toBe("text/plain");
  });

  it("returns application/json for .json", () => {
    expect(mimeFromExtension(".json")).toBe("application/json");
  });

  it("returns image/png for .png", () => {
    expect(mimeFromExtension(".png")).toBe("image/png");
  });

  it("returns image/jpeg for both .jpg and .jpeg", () => {
    expect(mimeFromExtension(".jpg")).toBe("image/jpeg");
    expect(mimeFromExtension(".jpeg")).toBe("image/jpeg");
  });

  it("returns application/pdf for .pdf", () => {
    expect(mimeFromExtension(".pdf")).toBe("application/pdf");
  });

  it("returns application/octet-stream for unknown extensions", () => {
    expect(mimeFromExtension(".xyz")).toBe("application/octet-stream");
    expect(mimeFromExtension(".unknown")).toBe("application/octet-stream");
  });

  it("is case-insensitive", () => {
    expect(mimeFromExtension(".JSON")).toBe("application/json");
    expect(mimeFromExtension(".PNG")).toBe("image/png");
    expect(mimeFromExtension(".Md")).toBe("text/markdown");
  });

  it("handles all document types", () => {
    expect(mimeFromExtension(".md")).toBe("text/markdown");
    expect(mimeFromExtension(".html")).toBe("text/html");
    expect(mimeFromExtension(".css")).toBe("text/css");
    expect(mimeFromExtension(".js")).toBe("application/javascript");
    expect(mimeFromExtension(".xml")).toBe("application/xml");
    expect(mimeFromExtension(".csv")).toBe("text/csv");
  });

  it("handles archive types", () => {
    expect(mimeFromExtension(".zip")).toBe("application/zip");
    expect(mimeFromExtension(".tar")).toBe("application/x-tar");
    expect(mimeFromExtension(".gz")).toBe("application/gzip");
  });

  it("handles media types", () => {
    expect(mimeFromExtension(".mp3")).toBe("audio/mpeg");
    expect(mimeFromExtension(".mp4")).toBe("video/mp4");
    expect(mimeFromExtension(".wav")).toBe("audio/wav");
    expect(mimeFromExtension(".gif")).toBe("image/gif");
    expect(mimeFromExtension(".svg")).toBe("image/svg+xml");
    expect(mimeFromExtension(".webp")).toBe("image/webp");
  });

  it("handles Office document types", () => {
    expect(mimeFromExtension(".docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mimeFromExtension(".xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(mimeFromExtension(".pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });
});
