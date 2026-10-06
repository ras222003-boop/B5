import { describe, expect, it } from 'vitest';
import { SpeechRequestSchema, VOICES, normalizeSpeechText, routeVoice, voicesFor } from './speech';

const base = { text: 'ما عاصمة المملكة العربية السعودية؟', language: 'ar' as const, arabicStyle: 'SAUDI' as const, context: 'EXAM' as const, rate: 1 };
describe('speech routing and academic text', () => {
  it('uses the Saudi accent without rewriting an exam question', () => {
    const request = SpeechRequestSchema.parse(base);
    expect(routeVoice(request).locale).toBe('ar-SA');
    expect(normalizeSpeechText(request)).toBe(base.text);
    expect(normalizeSpeechText({ ...request, context: 'QUESTION', text: 'غرفة 121، 15 متر، E=mc²' })).toBe('غرفة 121، 15 متر، E=mc²');
  });
  it('routes MSA, English and Chinese to documented Chirp locales', () => {
    expect(routeVoice({ ...base, arabicStyle: 'MSA' }).locale).toBe('ar-XA');
    expect(routeVoice({ ...base, language: 'en' }).locale).toBe('en-US');
    expect(routeVoice({ ...base, language: 'zh-CN' }).locale).toBe('cmn-CN');
  });
  it('has male and female options for every language and style', () => {
    for (const [lang, style] of [['ar', 'MSA'], ['ar', 'SAUDI'], ['en', 'MSA'], ['zh-CN', 'MSA']] as const) {
      const voices = voicesFor(lang, style);
      expect(voices.map(v => v.gender)).toContain('MALE');
      expect(voices.map(v => v.gender)).toContain('FEMALE');
      expect(new Set(voices.map(v => v.id)).size).toBe(voices.length);
    }
    expect(VOICES.length).toBeGreaterThan(10);
  });
  it('uses the requested valid voice and ignores cross-locale IDs', () => {
    expect(routeVoice({ ...base, voiceId: 'ar-SA-HamedNeural' }).id).toBe('ar-SA-HamedNeural');
    expect(routeVoice({ ...base, voiceId: 'en-US-Chirp3-HD-Kore' }).locale).toBe('ar-SA');
  });
  it('speaks room digits separately and distances as quantities in navigation only', () => {
    expect(normalizeSpeechText({ ...base, context: 'NAVIGATION', text: 'غرفة 121 بعد 15 متر' })).toBe('غرفة واحد اثنين واحد بعد خمسة عشر متر');
    expect(normalizeSpeechText({ ...base, arabicStyle: 'MSA', context: 'NAVIGATION', text: 'غرفة 121 بعد 15 متر' })).toBe('الغرفة رقم واحد اثنان واحد بعد خمسة عشر مترًا');
    expect(normalizeSpeechText({ ...base, context: 'NAVIGATION', text: 'غرفة ١٢١ بعد ١٥ متر' })).toBe('غرفة واحد اثنين واحد بعد خمسة عشر متر');
    expect(normalizeSpeechText({ ...base, context: 'GENERAL', text: 'غرفة 121 بعد 15 متر' })).toBe('غرفة 121 بعد 15 متر');
  });
  it('rejects oversized, malformed and unsupported synthesis input', () => {
    expect(SpeechRequestSchema.safeParse({ ...base, text: 'x'.repeat(4501) }).success).toBe(false);
    expect(SpeechRequestSchema.safeParse({ ...base, language: 'fr' }).success).toBe(false);
    expect(SpeechRequestSchema.safeParse({ ...base, rate: 4 }).success).toBe(false);
  });
});
