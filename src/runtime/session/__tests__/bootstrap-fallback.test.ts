// cspell:disable
import { describe, it, expect } from "vitest";
import { getKickoffGreeting, SUPPORTED_GREETING_LANGS } from "../bootstrap-fallback.js";

describe("bootstrap-fallback", () => {
  it("returns the French greeting for 'fr'", () => {
    const g = getKickoffGreeting("fr");
    expect(g).toMatch(/Présente-toi/i);
  });

  it("returns the English greeting for 'en'", () => {
    const g = getKickoffGreeting("en");
    expect(g).toMatch(/introduce yourself/i);
  });

  it("falls back to English for an unsupported language", () => {
    const g = getKickoffGreeting("zz");
    expect(g).toMatch(/introduce yourself/i);
  });

  it("falls back to English when language is undefined", () => {
    const g = getKickoffGreeting(undefined);
    expect(g).toMatch(/introduce yourself/i);
  });

  it("falls back to English when language is null", () => {
    const g = getKickoffGreeting(null);
    expect(g).toMatch(/introduce yourself/i);
  });

  it("returns the German greeting for 'de'", () => {
    expect(getKickoffGreeting("de")).toMatch(/Stell dich bitte vor/i);
  });

  it("returns the Spanish greeting for 'es'", () => {
    expect(getKickoffGreeting("es")).toMatch(/preséntate/i);
  });

  it("returns the Italian greeting for 'it'", () => {
    expect(getKickoffGreeting("it")).toMatch(/Presentati/i);
  });

  it("returns the Portuguese greeting for 'pt'", () => {
    expect(getKickoffGreeting("pt")).toMatch(/Apresenta-te/i);
  });

  it("exports the six supported languages", () => {
    expect(SUPPORTED_GREETING_LANGS).toEqual(["en", "fr", "de", "es", "it", "pt"]);
  });
});
