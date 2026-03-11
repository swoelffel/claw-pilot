import { configureLocalization, type LocaleModule } from "@lit/localize";

// Supported locales
export const sourceLocale = "en";
export const targetLocales = ["fr", "de", "es", "it", "pt"] as const;
export type SupportedLocale = "en" | "fr" | "de" | "es" | "it" | "pt";

export const allLocales: { code: SupportedLocale; label: string; flag: string; name: string }[] = [
  { code: "en", label: "EN", flag: "🇬🇧", name: "English" },
  { code: "fr", label: "FR", flag: "🇫🇷", name: "Français" },
  { code: "de", label: "DE", flag: "🇩🇪", name: "Deutsch" },
  { code: "es", label: "ES", flag: "🇪🇸", name: "Español" },
  { code: "it", label: "IT", flag: "🇮🇹", name: "Italiano" },
  { code: "pt", label: "PT", flag: "🇵🇹", name: "Português" },
];

const STORAGE_KEY = "cp-locale";

// Lazy loaders for each target locale
const localizedTemplates: Record<string, () => Promise<LocaleModule>> = {
  fr: () => import("./locales/fr.js") as Promise<LocaleModule>,
  de: () => import("./locales/de.js") as Promise<LocaleModule>,
  es: () => import("./locales/es.js") as Promise<LocaleModule>,
  it: () => import("./locales/it.js") as Promise<LocaleModule>,
  pt: () => import("./locales/pt.js") as Promise<LocaleModule>,
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
  const stored = localStorage.getItem(STORAGE_KEY) as SupportedLocale | null;
  const valid: SupportedLocale[] = ["en", "fr", "de", "es", "it", "pt"];
  if (stored && valid.includes(stored)) return stored;
  const lang = navigator.language ?? "en";
  if (lang.startsWith("fr")) return "fr";
  if (lang.startsWith("de")) return "de";
  if (lang.startsWith("es")) return "es";
  if (lang.startsWith("it")) return "it";
  if (lang.startsWith("pt")) return "pt";
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
