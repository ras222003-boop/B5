import { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { useI18n } from '@/i18n';
import { getSpeechPreferences, saveSpeechPreferences, speechEngine, voicePreview, type SpeechPreferences } from '@/lib/speechEngine';
import { voicesFor } from '@shared/speech';

export default function VoiceSettings() {
  const { lang } = useI18n();
  const [value, setValue] = useState<SpeechPreferences>(getSpeechPreferences);
  const [mode, setMode] = useState(speechEngine.status.mode);
  const [available, setAvailable] = useState<Record<string, boolean>>({});
  useEffect(() => speechEngine.subscribe(state => setMode(state.mode)), []);
  useEffect(() => { fetch('/api/speech/voices').then(r => r.json()).then(data => setAvailable(Object.fromEntries(data.voices.map((v: { id: string; available: boolean }) => [v.id, v.available])))).catch(() => {}); }, []);
  const update = (patch: Partial<SpeechPreferences>) => {
    const draft = { ...value, ...patch };
    const voices = voicesFor(draft.language, draft.arabicStyle).filter(voice => voice.gender === draft.gender);
    if (!voices.some(voice => voice.id === draft.voiceId)) draft.voiceId = voices[0].id;
    setValue(draft); saveSpeechPreferences(draft);
  };
  const voices = voicesFor(value.language, value.arabicStyle).filter(voice => voice.gender === value.gender);
  const labels = lang === 'ar' ? { title: 'إعدادات الصوت', language: 'اللغة', style: 'نمط العربية', msa: 'العربية الفصحى', saudi: 'العربية السعودية', gender: 'نوع الصوت', female: 'امرأة', male: 'رجل', voice: 'الصوت', speed: 'السرعة', slow: 'بطيء', normal: 'طبيعي', fast: 'أسرع', preview: 'استمع إلى الصوت', stop: 'إيقاف الصوت', screenReader: 'استخدم قارئ الشاشة بدل صوت بصيرة', local: 'الصوت المحلي قيد الاستخدام', premium: 'الصوت العصبي قيد الاستخدام', muted: 'صوت بصيرة متوقف لقارئ الشاشة', unavailable: 'مزود هذا الصوت غير مُعدّ بعد؛ سيُستخدم صوت المتصفح' } : lang === 'en' ? { title: 'Voice settings', language: 'Language', style: 'Arabic style', msa: 'Modern Standard Arabic', saudi: 'Saudi Arabic', gender: 'Voice gender', female: 'Woman', male: 'Man', voice: 'Voice', speed: 'Speed', slow: 'Slow', normal: 'Normal', fast: 'Faster', preview: 'Listen to voice', stop: 'Stop speech', screenReader: 'Use screen reader instead of Basira voice', local: 'Local browser voice in use', premium: 'Neural voice in use', muted: 'Basira voice muted for screen reader', unavailable: 'This provider is not configured; browser voice will be used' } : { title: '语音设置', language: '语言', style: '阿拉伯语风格', msa: '现代标准阿拉伯语', saudi: '沙特阿拉伯语', gender: '声音类型', female: '女声', male: '男声', voice: '声音', speed: '语速', slow: '慢', normal: '正常', fast: '快', preview: '试听声音', stop: '停止朗读', screenReader: '使用屏幕阅读器代替 بصيرة 语音', local: '正在使用浏览器本地语音', premium: '正在使用神经语音', muted: '屏幕阅读器模式已静音', unavailable: '此语音服务尚未配置，将使用浏览器语音' };
  const field = 'mt-2 min-h-12 w-full rounded-lg border border-amber-300/40 bg-stone-950 px-3 text-white';
  return <Layout><main className="container max-w-2xl space-y-5 py-10 text-white" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <h1 className="text-3xl font-bold">{labels.title}</h1>
    <label className="block">{labels.language}<select className={field} value={value.language} onChange={e => update({ language: e.target.value as SpeechPreferences['language'] })}><option value="ar">العربية</option><option value="en">English</option><option value="zh-CN">中文</option></select></label>
    {value.language === 'ar' && <fieldset className="rounded-xl border border-amber-300/30 p-4"><legend>{labels.style}</legend><label className="me-5 inline-flex min-h-12 items-center gap-2"><input type="radio" name="arabic-style" checked={value.arabicStyle === 'MSA'} onChange={() => update({ arabicStyle: 'MSA' })}/>{labels.msa}</label><label className="inline-flex min-h-12 items-center gap-2"><input type="radio" name="arabic-style" checked={value.arabicStyle === 'SAUDI'} onChange={() => update({ arabicStyle: 'SAUDI' })}/>{labels.saudi}</label></fieldset>}
    <label className="block">{labels.gender}<select className={field} value={value.gender} onChange={e => update({ gender: e.target.value as SpeechPreferences['gender'] })}><option value="FEMALE">{labels.female}</option><option value="MALE">{labels.male}</option></select></label>
    <label className="block">{labels.voice}<select className={field} value={value.voiceId} onChange={e => update({ voiceId: e.target.value })}>{voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} · {voice.provider}</option>)}</select></label>
    {available[value.voiceId] === false && <p role="status" className="text-amber-200">{labels.unavailable}</p>}
    <label className="block">{labels.speed}<select className={field} value={value.rate} onChange={e => update({ rate: Number(e.target.value) })}><option value={0.85}>{labels.slow}</option><option value={1}>{labels.normal}</option><option value={1.15}>{labels.fast}</option></select></label>
    <label className="flex items-center gap-3"><input type="checkbox" checked={value.screenReaderMode} onChange={e => { update({ screenReaderMode: e.target.checked }); if (e.target.checked) speechEngine.stop(); }}/>{labels.screenReader}</label>
    <div className="flex gap-3"><button className="min-h-12 rounded-lg bg-amber-300 px-4 font-bold text-stone-950" onClick={() => void voicePreview()}>{labels.preview}</button><button className="min-h-12 rounded-lg border border-amber-300 px-4" onClick={() => speechEngine.stop()}>{labels.stop}</button></div>
    <p role="status" aria-live="polite">{mode === 'PREMIUM' ? labels.premium : mode === 'MUTED' ? labels.muted : labels.local}</p>
  </main></Layout>;
}
