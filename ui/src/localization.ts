import { configureLocalization } from "@lit/localize";

// Supported locales
export const sourceLocale = "en";
export const targetLocales = ["fr"] as const;
export type SupportedLocale = "en" | "fr";

export const allLocales: { code: SupportedLocale; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "fr", label: "FR" },
];

const STORAGE_KEY = "cp-locale";

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

/** Detect the best locale: localStorage > navigator.language > "en" */
function detectLocale(): SupportedLocale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "fr") return stored;
  const lang = navigator.language ?? "en";
  if (lang.startsWith("fr")) return "fr";
  return "en";
}

/** Call once at app startup — sets locale based on stored preference or browser language */
export async function initLocale(): Promise<void> {
  const locale = detectLocale();
  if (locale !== sourceLocale) {
    await setLocale(locale);
  }
}

/** Switch locale and persist the choice */
export async function switchLocale(locale: SupportedLocale): Promise<void> {
  localStorage.setItem(STORAGE_KEY, locale);
  await setLocale(locale);
}
