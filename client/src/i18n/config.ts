/**
 * Central language configuration for Basira.
 * Every UI string, AI request, OCR call and speech service derives its
 * language from the single `Lang` value managed by `I18nProvider`.
 */
export const LANGS = ["ar", "en", "zh-CN"] as const;
export type Lang = (typeof LANGS)[number];
export type Direction = "rtl" | "ltr";

export interface LangMeta {
  /** Name of the language written in the language itself. */
  nativeName: string;
  /** Short badge shown in compact controls. */
  shortLabel: string;
  dir: Direction;
  /** Value written to `<html lang>`. */
  htmlLang: string;
  /** BCP-47 tag used for Intl formatting. */
  locale: string;
  /** Preferred Web Speech API tag for TTS and STT. */
  speechLang: "ar-SA" | "en-US" | "zh-CN";
}

export const LANG_META: Record<Lang, LangMeta> = {
  ar: { nativeName: "العربية", shortLabel: "ع", dir: "rtl", htmlLang: "ar", locale: "ar-SA", speechLang: "ar-SA" },
  en: { nativeName: "English", shortLabel: "EN", dir: "ltr", htmlLang: "en", locale: "en-US", speechLang: "en-US" },
  "zh-CN": { nativeName: "简体中文", shortLabel: "中", dir: "ltr", htmlLang: "zh-CN", locale: "zh-CN", speechLang: "zh-CN" },
};

export const DEFAULT_LANG: Lang = "ar";
export const LANG_STORAGE_KEY = "basira-lang";

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

/** Maps loose tags such as `zh`, `zh-Hans`, `en-GB` or `ar-EG` onto a supported language. */
export function normalizeLang(value: unknown): Lang | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const tag = value.trim().toLowerCase();
  if (tag.startsWith("zh")) return "zh-CN";
  if (tag.startsWith("en")) return "en";
  if (tag.startsWith("ar")) return "ar";
  return null;
}

/** Saved choice first, then the browser preference, then Arabic. */
export function resolveInitialLang(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage can be unavailable in private modes */
  }
  const preferred = [...(navigator.languages || []), navigator.language];
  for (const tag of preferred) {
    const lang = normalizeLang(tag);
    if (lang) return lang;
  }
  return DEFAULT_LANG;
}
