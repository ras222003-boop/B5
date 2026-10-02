import { Globe } from "lucide-react";
import { LANG_META, useCommonMessages, useI18n, type Lang } from "@/i18n";

interface LanguageSelectorProps {
  className?: string;
  /** Show full native names (mobile menu) instead of compact badges. */
  expanded?: boolean;
  onChange?: (lang: Lang) => void;
}

/** Accessible radio-group language switcher: العربية / English / 简体中文. */
export default function LanguageSelector({ className = "", expanded = false, onChange }: LanguageSelectorProps) {
  const { lang, setLang, languages } = useI18n();
  const t = useCommonMessages();

  return (
    <div role="radiogroup" aria-label={t.language.choose} className={`inline-flex items-center gap-1 rounded-xl border border-amber-300/30 bg-black/30 p-1 ${className}`}>
      <Globe aria-hidden="true" className="mx-1 h-4 w-4 shrink-0 text-amber-300" />
      {languages.map(code => {
        const meta = LANG_META[code];
        const active = code === lang;
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={active}
            lang={meta.htmlLang}
            dir={meta.dir}
            title={meta.nativeName}
            aria-label={meta.nativeName}
            onClick={() => {
              if (code === lang) return;
              setLang(code);
              onChange?.(code);
            }}
            className={`min-h-9 rounded-lg px-2.5 text-xs font-extrabold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 ${
              active ? "bg-amber-300 text-[#17130d]" : "text-stone-300 hover:bg-amber-200/10 hover:text-amber-100"
            }`}
          >
            {expanded ? meta.nativeName : meta.shortLabel}
          </button>
        );
      })}
      <span className="sr-only" aria-live="polite">{t.language.changed(LANG_META[lang].nativeName)}</span>
    </div>
  );
}
