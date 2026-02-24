import { configureLocalization } from "@lit/localize";

// Supported locales
export const sourceLocale = "en";
export const targetLocales = ["fr"] as const;
export type SupportedLocale = "en" | "fr";

// Lazy loaders for each target locale
const localizedTemplates: Record<string, () => Promise<unknown>> = {
  fr: () => import("./locales/fr.js"),
};

export const { getLocale, setLocale } = configureLocalization({
  sourceLocale,
  targetLocales: [...targetLocales],
  loadLocale: (locale: string) => {
    const loader = localizedTemplates[locale];
    if (!loader) return Promise.reject(new Error(`Unknown locale: ${locale}`));
    return loader();
  },
});

/** Detect the best locale from navigator.language, fallback to "en" */
function detectLocale(): SupportedLocale {
  const lang = navigator.language ?? "en";
  // Match "fr", "fr-FR", "fr-BE", etc.
  if (lang.startsWith("fr")) return "fr";
  return "en";
}

/** Call once at app startup — sets locale based on browser language */
export async function initLocale(): Promise<void> {
  const locale = detectLocale();
  if (locale !== sourceLocale) {
    await setLocale(locale);
  }
}
