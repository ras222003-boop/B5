import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LANG_META, LANG_STORAGE_KEY, LANGS, resolveInitialLang, type Direction, type Lang, type LangMeta } from "./config";
import type { Messages, Widen } from "./define";
import { commonMessages } from "./locales/common";

interface I18nContextValue {
  lang: Lang;
  dir: Direction;
  isRTL: boolean;
  meta: LangMeta;
  languages: readonly Lang[];
  setLang: (lang: Lang) => void;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const CJK_FONT_ID = "basira-font-zh";
const CJK_FONT_HREF = "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&display=swap";

/** Writes language, direction and localized metadata to the document. */
export function applyDocumentLanguage(lang: Lang) {
  if (typeof document === "undefined") return;
  const meta = LANG_META[lang];
  const root = document.documentElement;
  root.lang = meta.htmlLang;
  root.dir = meta.dir;
  root.dataset.lang = lang;
  document.title = commonMessages[lang].meta.title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", commonMessages[lang].meta.description);
  if (lang === "zh-CN" && !document.getElementById(CJK_FONT_ID)) {
    const link = document.createElement("link");
    link.id = CJK_FONT_ID;
    link.rel = "stylesheet";
    link.href = CJK_FONT_HREF;
    document.head.appendChild(link);
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => resolveInitialLang());

  useEffect(() => {
    applyDocumentLanguage(lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      /* ignore unavailable storage */
    }
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const meta = LANG_META[lang];
    return {
      lang,
      dir: meta.dir,
      isRTL: meta.dir === "rtl",
      meta,
      languages: LANGS,
      setLang,
      formatNumber: (n, options) => new Intl.NumberFormat(meta.locale, options).format(n),
      formatDate: (d, options) => new Intl.DateTimeFormat(meta.locale, options ?? { dateStyle: "medium" }).format(new Date(d)),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

/** Returns the active-language branch of a namespace created with `defineMessages`. */
export function useMessages<T>(messages: Messages<T>): Widen<T> {
  const { lang } = useI18n();
  return messages[lang];
}

/** Shared layout/navigation/state strings. */
export function useCommonMessages() {
  return useMessages(commonMessages);
}
