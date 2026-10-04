import type { ArabicStyle } from '@shared/speech';
import type { GuidanceLanguage } from './instructions';

export const GuidanceSystemPhraseCatalog = {
  ar: {
    lost: 'تعذر تحديد موقعك بدقة. توقف وأعد تحديد موقعك باستخدام لوحة معروفة أو QR أو تأكيد يدوي.',
    recovered: 'تم تحديد موقعك، وسأتابع التوجيه.',
    offRoute: 'ابتعدت عن المسار الحالي. سأعيد حساب الطريق.',
    whereUncertain: 'موقعي الحالي غير مؤكد بما يكفي.',
    whereKnown: (floor: string, place: string) => `أنت في ${floor}، بالقرب من ${place}.`,
    visionUnavailable: 'الرؤية غير متاحة الآن؛ لا أستطيع وصف ما أمامك.',
    rerouting: 'سأعيد حساب المسار.',
    cancelled: 'أُلغي التنقل.',
  },
  'ar-SA': {
    lost: 'موقعك مو واضح الآن. وقف وثبت موقعك عند لوحة معروفة أو رمز QR أو بتأكيد يدوي.',
    recovered: 'تأكد موقعك. بكمل التوجيه.',
    offRoute: 'ابتعدت عن المسار. بحسب لك طريق جديد.',
    whereUncertain: 'موقعك الآن مو واضح بما يكفي.',
    whereKnown: (floor: string, place: string) => `أنت في ${floor}، قريب من ${place}.`,
    visionUnavailable: 'الرؤية مو متاحة الآن. ما أقدر أوصف اللي قدامك.',
    rerouting: 'بحسب لك مسار جديد.',
    cancelled: 'توقف التنقل.',
  },
  en: {
    lost: 'Your location is uncertain. Stop and confirm your position using a known sign, QR code, or manual confirmation.',
    recovered: 'Your location is confirmed. Guidance will continue.',
    offRoute: 'You are off route. I will calculate a new route.',
    whereUncertain: 'Your current location is not certain enough.',
    whereKnown: (floor: string, place: string) => `You are on ${floor}, near ${place}.`,
    visionUnavailable: 'Vision is unavailable now. I cannot describe what is ahead.',
    rerouting: 'I will calculate a new route.',
    cancelled: 'Navigation stopped.',
  },
  'zh-CN': {
    lost: '无法准确确定您的位置。请停下，并通过已知标志、二维码或手动确认位置。',
    recovered: '已确认您的位置。继续导航。',
    offRoute: '您已偏离路线。正在重新规划。',
    whereUncertain: '目前无法充分确认您的位置。',
    whereKnown: (floor: string, place: string) => `您在${floor}，靠近${place}。`,
    visionUnavailable: '目前无法使用视觉功能，不能描述前方环境。',
    rerouting: '正在重新规划路线。',
    cancelled: '导航已停止。',
  },
} as const;

export function guidancePhrases(language: GuidanceLanguage, arabicStyle: ArabicStyle) {
  return language === 'ar' && arabicStyle === 'SAUDI' ? GuidanceSystemPhraseCatalog['ar-SA'] : GuidanceSystemPhraseCatalog[language];
}
