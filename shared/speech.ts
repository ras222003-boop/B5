import { z } from 'zod';

export const SpeechRequestSchema = z.object({
  text: z.string().trim().min(1).max(4500).refine(text => new TextEncoder().encode(text).length <= 4500),
  language: z.enum(['ar', 'en', 'zh-CN']),
  arabicStyle: z.enum(['MSA', 'SAUDI']).default('MSA'),
  voiceId: z.string().max(90).optional(),
  context: z.enum(['NAVIGATION', 'SAFETY', 'EXAM', 'QUESTION', 'ANSWER_OPTION', 'ENVIRONMENT', 'GENERAL']).default('GENERAL'),
  rate: z.number().min(0.7).max(1.3).default(1),
});
export type SpeechRequest = z.infer<typeof SpeechRequestSchema>;
export type SpeechContext = SpeechRequest['context'];
export type ArabicStyle = SpeechRequest['arabicStyle'];
export type SpeechLanguage = SpeechRequest['language'];
export type SpeechPriority = 'CRITICAL_SAFETY' | 'HIGH_SAFETY' | 'RELOCALIZATION' | 'TURN' | 'ARRIVAL' | 'INFORMATION';
export const priorityRank: Record<SpeechPriority, number> = { CRITICAL_SAFETY: 6, HIGH_SAFETY: 5, RELOCALIZATION: 4, TURN: 3, ARRIVAL: 2, INFORMATION: 1 };
export type Voice = { id: string; name: string; language: SpeechLanguage; arabicStyle: ArabicStyle; gender: 'FEMALE' | 'MALE'; provider: 'GOOGLE' | 'AZURE'; locale: string };

// Google Chirp 3 HD and Azure ar-SA IDs are from their official voice catalogs.
export const VOICES: readonly Voice[] = [
  { id: 'ar-XA-Chirp3-HD-Aoede', name: 'Aoede', language: 'ar', arabicStyle: 'MSA', gender: 'FEMALE', provider: 'GOOGLE', locale: 'ar-XA' },
  { id: 'ar-XA-Chirp3-HD-Kore', name: 'Kore', language: 'ar', arabicStyle: 'MSA', gender: 'FEMALE', provider: 'GOOGLE', locale: 'ar-XA' },
  { id: 'ar-XA-Chirp3-HD-Charon', name: 'Charon', language: 'ar', arabicStyle: 'MSA', gender: 'MALE', provider: 'GOOGLE', locale: 'ar-XA' },
  { id: 'ar-XA-Chirp3-HD-Fenrir', name: 'Fenrir', language: 'ar', arabicStyle: 'MSA', gender: 'MALE', provider: 'GOOGLE', locale: 'ar-XA' },
  { id: 'ar-SA-ZariyahNeural', name: 'Zariyah', language: 'ar', arabicStyle: 'SAUDI', gender: 'FEMALE', provider: 'AZURE', locale: 'ar-SA' },
  { id: 'ar-SA-HamedNeural', name: 'Hamed', language: 'ar', arabicStyle: 'SAUDI', gender: 'MALE', provider: 'AZURE', locale: 'ar-SA' },
  { id: 'en-US-Chirp3-HD-Aoede', name: 'Aoede', language: 'en', arabicStyle: 'MSA', gender: 'FEMALE', provider: 'GOOGLE', locale: 'en-US' },
  { id: 'en-US-Chirp3-HD-Kore', name: 'Kore', language: 'en', arabicStyle: 'MSA', gender: 'FEMALE', provider: 'GOOGLE', locale: 'en-US' },
  { id: 'en-US-Chirp3-HD-Charon', name: 'Charon', language: 'en', arabicStyle: 'MSA', gender: 'MALE', provider: 'GOOGLE', locale: 'en-US' },
  { id: 'en-US-Chirp3-HD-Fenrir', name: 'Fenrir', language: 'en', arabicStyle: 'MSA', gender: 'MALE', provider: 'GOOGLE', locale: 'en-US' },
  { id: 'cmn-CN-Chirp3-HD-Aoede', name: 'Aoede', language: 'zh-CN', arabicStyle: 'MSA', gender: 'FEMALE', provider: 'GOOGLE', locale: 'cmn-CN' },
  { id: 'cmn-CN-Chirp3-HD-Kore', name: 'Kore', language: 'zh-CN', arabicStyle: 'MSA', gender: 'FEMALE', provider: 'GOOGLE', locale: 'cmn-CN' },
  { id: 'cmn-CN-Chirp3-HD-Charon', name: 'Charon', language: 'zh-CN', arabicStyle: 'MSA', gender: 'MALE', provider: 'GOOGLE', locale: 'cmn-CN' },
  { id: 'cmn-CN-Chirp3-HD-Fenrir', name: 'Fenrir', language: 'zh-CN', arabicStyle: 'MSA', gender: 'MALE', provider: 'GOOGLE', locale: 'cmn-CN' },
];

export function voicesFor(language: SpeechLanguage, arabicStyle: ArabicStyle = 'MSA') {
  return VOICES.filter(voice => voice.language === language && (language !== 'ar' || voice.arabicStyle === arabicStyle));
}

export function routeVoice(input: SpeechRequest): Voice {
  const choices = voicesFor(input.language, input.arabicStyle);
  return choices.find(voice => voice.id === input.voiceId) ?? choices[0];
}

const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const teens = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
function arabicQuantity(value: number): string {
  if (value === 0) return 'صفر';
  if (value < 10) return ones[value];
  if (value < 20) return teens[value - 10];
  if (value < 100) return value % 10 ? `${ones[value % 10]} و${tens[Math.floor(value / 10)]}` : tens[value / 10];
  if (value < 1000) return `${value < 200 ? 'مئة' : `${ones[Math.floor(value / 100)]} مئة`}${value % 100 ? ` و${arabicQuantity(value % 100)}` : ''}`;
  return String(value);
}
function digitValue(digit: string) {
  const code = digit.charCodeAt(0);
  return code >= 0x660 && code <= 0x669 ? code - 0x660 : code >= 0x6f0 && code <= 0x6f9 ? code - 0x6f0 : Number(digit);
}

/** Pronunciation only. Academic, OCR, and user text stay byte-for-byte identical. */
export function normalizeSpeechText(input: SpeechRequest): string {
  if (!['NAVIGATION', 'SAFETY'].includes(input.context) || input.language !== 'ar') return input.text;
  return input.text
    .replace(/(?:الغرفة|غرفة)\s*([0-9٠-٩۰-۹]{2,5})/g, (_whole, digits: string) => `${input.arabicStyle === 'SAUDI' ? 'غرفة' : 'الغرفة رقم'} ${digits.split('').map(d => input.arabicStyle === 'SAUDI' && digitValue(d) === 2 ? 'اثنين' : arabicQuantity(digitValue(d))).join(' ')}`)
    .replace(/([0-9٠-٩۰-۹]{1,3})\s*(?:مترًا|متر|أمتار)/g, (_whole, digits: string) => `${arabicQuantity(Number(digits.split('').map(digitValue).join('')))} ${input.arabicStyle === 'SAUDI' ? 'متر' : 'مترًا'}`);
}

export const previewText = {
  MSA: 'مرحبًا بك في بصيرة. سأساعدك في قراءة الاختبار والتنقل بوضوح.',
  SAUDI: 'حياك في بصيرة. بساعدك في قراءة الاختبار والتنقل بشكل واضح.',
  en: 'Welcome to Basira. I will help you read exams and navigate clearly.',
  'zh-CN': '欢迎使用 بصيرة。我会帮助您清晰地阅读考试内容并导航。',
} as const;
