/** The 80 non-placeholder names in the installed EfficientDet label metadata. */
const entries: [string, string, boolean][] = [
  ["person", "شخص", false],
  ["bicycle", "دراجة", true],
  ["car", "سيارة", true],
  ["motorcycle", "دراجة نارية", true],
  ["airplane", "طائرة", true],
  ["bus", "حافلة", true],
  ["train", "قطار", false],
  ["truck", "شاحنة", true],
  ["boat", "قارب", false],
  ["traffic light", "إشارة مرور", true],
  ["fire hydrant", "صنبور إطفاء", false],
  ["stop sign", "علامة توقف", true],
  ["parking meter", "عداد موقف", false],
  ["bench", "مقعد", false],
  ["bird", "طائر", false],
  ["cat", "قطة", true],
  ["dog", "كلب", false],
  ["horse", "حصان", false],
  ["sheep", "خروف", false],
  ["cow", "بقرة", true],
  ["elephant", "فيل", false],
  ["bear", "دب", false],
  ["zebra", "حمار وحشي", false],
  ["giraffe", "زرافة", true],
  ["backpack", "حقيبة ظهر", true],
  ["umbrella", "مظلة", true],
  ["handbag", "حقيبة يد", true],
  ["tie", "ربطة عنق", true],
  ["suitcase", "حقيبة سفر", true],
  ["frisbee", "قرص طائر", false],
  ["skis", "زلاجات", true],
  ["snowboard", "لوح تزلج ثلجي", false],
  ["sports ball", "كرة رياضية", true],
  ["kite", "طائرة ورقية", true],
  ["baseball bat", "مضرب بيسبول", false],
  ["baseball glove", "قفاز بيسبول", false],
  ["skateboard", "لوح تزلج", false],
  ["surfboard", "لوح ركوب أمواج", false],
  ["tennis racket", "مضرب تنس", false],
  ["bottle", "زجاجة", true],
  ["wine glass", "كأس", false],
  ["cup", "كوب", false],
  ["fork", "شوكة", true],
  ["knife", "سكين", true],
  ["spoon", "ملعقة", true],
  ["bowl", "وعاء", false],
  ["banana", "موزة", true],
  ["apple", "تفاحة", true],
  ["sandwich", "شطيرة", true],
  ["orange", "برتقالة", true],
  ["broccoli", "بروكلي", false],
  ["carrot", "جزرة", true],
  ["hot dog", "شطيرة نقانق", true],
  ["pizza", "بيتزا", true],
  ["donut", "كعكة دونات", true],
  ["cake", "كعكة", true],
  ["chair", "كرسي", false],
  ["couch", "أريكة", true],
  ["potted plant", "نبتة في أصيص", true],
  ["bed", "سرير", false],
  ["dining table", "طاولة", true],
  ["toilet", "مرحاض", false],
  ["tv", "تلفاز", false],
  ["laptop", "حاسوب محمول", false],
  ["mouse", "فأرة حاسوب", true],
  ["remote", "جهاز تحكم", false],
  ["keyboard", "لوحة مفاتيح", true],
  ["cell phone", "هاتف محمول", false],
  ["microwave", "ميكروويف", false],
  ["oven", "فرن", false],
  ["toaster", "محمصة", true],
  ["sink", "حوض", false],
  ["refrigerator", "ثلاجة", true],
  ["book", "كتاب", false],
  ["clock", "ساعة", true],
  ["vase", "مزهرية", true],
  ["scissors", "مقص", false],
  ["teddy bear", "دب لعبة", false],
  ["hair drier", "مجفف شعر", false],
  ["toothbrush", "فرشاة أسنان", true],
];
export const COCO_LABELS: Readonly<
  Record<string, { ar: string; feminine: boolean }>
> = Object.freeze(
  Object.fromEntries(
    entries.map(([name, ar, feminine]) => [name, { ar, feminine }])
  )
);
export function objectLabel(
  detection: { cocoClass?: string; type: string },
  copy: { object: Record<string, string> }
): string {
  const label = detection.cocoClass && COCO_LABELS[detection.cocoClass];
  if (label)
    return copy.object.PERSON === "شخص"
      ? label.ar
      : detection.type === "UNKNOWN_OBSTACLE"
        ? detection.cocoClass!
        : (copy.object[detection.type] ?? detection.cocoClass!);
  return copy.object[detection.type] ?? copy.object.UNKNOWN_OBSTACLE;
}
