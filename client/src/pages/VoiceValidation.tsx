import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import Layout from '@/components/Layout';
import { speechEngine } from '@/lib/speechEngine';
import { previewText, VOICES, type Voice, type SpeechContext } from '@shared/speech';

type Sample = { label: string; text: string; context: SpeechContext };
const samples: Record<string, Sample[]> = {
  MSA: [
    { label: 'Preview', text: previewText.MSA, context: 'GENERAL' },
    { label: 'Navigation', text: 'بعد خمسة عشر مترًا، انعطف يمينًا.', context: 'NAVIGATION' },
    { label: 'Safety', text: 'توقف. يوجد عائق أمامك.', context: 'SAFETY' },
    { label: 'Room', text: 'الغرفة رقم واحد اثنان واحد أمامك.', context: 'NAVIGATION' },
    { label: 'Distance', text: 'المسافة خمسة عشر مترًا.', context: 'NAVIGATION' },
    { label: 'Exam', text: 'ما عاصمة المملكة العربية السعودية؟', context: 'QUESTION' },
  ],
  SAUDI: [
    { label: 'Preview', text: previewText.SAUDI, context: 'GENERAL' },
    { label: 'Navigation', text: 'بعد خمسة عشر متر خذ يمين.', context: 'NAVIGATION' },
    { label: 'Safety', text: 'وقف. فيه عائق قدامك.', context: 'SAFETY' },
    { label: 'Room', text: 'غرفة واحد اثنين واحد قدامك.', context: 'NAVIGATION' },
    { label: 'Distance', text: 'باقي خمسة عشر متر.', context: 'NAVIGATION' },
    { label: 'Exam', text: 'ما عاصمة المملكة العربية السعودية؟', context: 'QUESTION' },
  ],
  en: [
    { label: 'Preview', text: previewText.en, context: 'GENERAL' },
    { label: 'Navigation', text: 'In fifteen meters, turn right.', context: 'NAVIGATION' },
    { label: 'Safety', text: 'Stop. There is an obstacle ahead.', context: 'SAFETY' },
    { label: 'Room', text: 'Room one two one is ahead.', context: 'NAVIGATION' },
    { label: 'Distance', text: 'The destination is fifteen meters away.', context: 'NAVIGATION' },
    { label: 'Exam', text: 'What is the capital of Saudi Arabia?', context: 'QUESTION' },
  ],
  'zh-CN': [
    { label: 'Preview', text: '欢迎使用 بصيرة。我会帮助您阅读考试并清楚地导航。', context: 'GENERAL' },
    { label: 'Navigation', text: '十五米后右转。', context: 'NAVIGATION' },
    { label: 'Safety', text: '请停下，前方有障碍物。', context: 'SAFETY' },
    { label: 'Room', text: '一二一号房间就在前方。', context: 'NAVIGATION' },
    { label: 'Distance', text: '目的地距离这里十五米。', context: 'NAVIGATION' },
    { label: 'Exam', text: '沙特阿拉伯的首都是哪里？', context: 'QUESTION' },
  ],
};
function voiceSamples(voice: Voice) { return samples[voice.language === 'ar' ? voice.arabicStyle : voice.language]; }

export default function VoiceValidation() {
  const [selected, setSelected] = useState(VOICES[0].id);
  const [mode, setMode] = useState(speechEngine.status.mode);
  const voice = VOICES.find(candidate => candidate.id === selected)!;
  useEffect(() => speechEngine.subscribe(state => setMode(state.mode)), []);
  const play = (sample: Sample) => {
    speechEngine.stop();
    void speechEngine.enqueue({ text: sample.text, language: voice.language, arabicStyle: voice.arabicStyle, voiceId: voice.id, context: sample.context, rate: 1 });
  };
  return <Layout><main className="container max-w-4xl space-y-5 py-10" dir="ltr">
    <h1 className="text-3xl font-bold">Human voice listening validation</h1>
    <p className="font-bold text-amber-700">NOT LIVE VALIDATED — audio quality requires real provider credentials and human listening.</p>
    <p>Sign in and enable Premium TTS on the server to hear the selected cloud voice. If this page reports LOCAL, you are hearing browser fallback. Screen reader mode mutes Basira speech.</p>
    <Link href="/settings/voice" className="underline">Voice settings and screen reader mode</Link>
    <label className="block">Curated voice
      <select aria-label="Curated voice" className="mt-2 min-h-12 w-full rounded border p-2" value={selected} onChange={event => setSelected(event.target.value)}>
        {VOICES.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.language === 'ar' ? candidate.arabicStyle : candidate.language} · {candidate.name} · {candidate.provider} · {candidate.id}</option>)}
      </select>
    </label>
    <p role="status" aria-live="polite">Playback mode: {mode}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {voiceSamples(voice).map(sample => <div key={sample.label} className="rounded-xl border p-4">
        <button className="min-h-12 rounded-lg bg-amber-300 px-4 font-bold text-stone-950" onClick={() => play(sample)}>Play {sample.label}</button>
        <p className="mt-2" dir={voice.language === 'ar' ? 'rtl' : 'ltr'}>{sample.text}</p>
      </div>)}
    </div>
    <button className="min-h-12 rounded-lg border px-4" onClick={() => speechEngine.stop()}>Stop speech</button>
    <p>Record each voice's clarity, naturalness, pronunciation, navigation and safety behavior in the validation checklist. This page does not mark any voice as passed.</p>
  </main></Layout>;
}
