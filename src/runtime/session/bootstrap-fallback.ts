// cspell:disable
// src/runtime/session/bootstrap-fallback.ts
//
// Localized first-contact greeting used by the kickoff route when the user
// clicks the Start CTA. The greeting is posted as a normal user message — it
// becomes the first turn of the permanent session and triggers the agent's
// introduction (BOOTSTRAP.md is consumed automatically on this first call).

/** Supported greeting languages (mirrors the UI i18n matrix). */
export const SUPPORTED_GREETING_LANGS = ["en", "fr", "de", "es", "it", "pt"] as const;

export type GreetingLang = (typeof SUPPORTED_GREETING_LANGS)[number];

const GREETINGS: Record<GreetingLang, string> = {
  en: "Hi 👋 Please introduce yourself, explain what you can do, and suggest a couple of starting points.",
  fr: "Bonjour 👋 Présente-toi, explique ce que tu peux faire, et propose quelques points de départ.",
  de: "Hallo 👋 Stell dich bitte vor, erkläre was du kannst, und schlage ein paar Ausgangspunkte vor.",
  es: "Hola 👋 Por favor, preséntate, explica lo que puedes hacer y sugiere algunos puntos de partida.",
  it: "Ciao 👋 Presentati, spiega cosa puoi fare e suggerisci qualche punto di partenza.",
  pt: "Olá 👋 Apresenta-te, explica o que podes fazer e sugere alguns pontos de partida.",
};

function isSupportedLang(value: string | undefined | null): value is GreetingLang {
  return (
    typeof value === "string" && (SUPPORTED_GREETING_LANGS as readonly string[]).includes(value)
  );
}

/**
 * Return the localized kickoff greeting for the given language code.
 * Falls back to English when the language is unknown or undefined.
 */
export function getKickoffGreeting(lang: string | undefined | null): string {
  return GREETINGS[isSupportedLang(lang) ? lang : "en"];
}
