import { describe, expect, it } from "vitest";
import { LANG_META, LANGS, normalizeLang } from "./config";
import { commonMessages } from "./locales/common";
import { homeMessages } from "./locales/home";
import { howItWorksMessages } from "./locales/howItWorks";
import { featuresMessages } from "./locales/features";
import { roboticArmMessages } from "./locales/roboticArm";
import { teacherMessages } from "./locales/teacher";
import { analyticsMessages } from "./locales/analytics";
import { onlineExamsMessages } from "./locales/onlineExams";
import { floatingChatMessages } from "./locales/floatingChat";
import { photoRequirementsMessages } from "./locales/photoRequirements";
import { voiceGuideMessages } from "./locales/voiceGuide";
import { aiGuideMessages } from "./locales/aiGuide";
import { assistantMessages } from "./locales/assistant";
import { examDemoMessages } from "./locales/examDemo";
import { informationMessages } from "./locales/information";
import { accountMessages } from "./locales/account";
import { supportMessages } from "./locales/support";

const namespaces = {
  common: commonMessages,
  home: homeMessages,
  howItWorks: howItWorksMessages,
  features: featuresMessages,
  roboticArm: roboticArmMessages,
  teacher: teacherMessages,
  analytics: analyticsMessages,
  onlineExams: onlineExamsMessages,
  floatingChat: floatingChatMessages,
  photoRequirements: photoRequirementsMessages,
  voiceGuide: voiceGuideMessages,
  aiGuide: aiGuideMessages,
  assistant: assistantMessages,
  examDemo: examDemoMessages,
  information: informationMessages,
  account: accountMessages,
  support: supportMessages,
};

function collect(value: unknown, path = "root"): string[] {
  // The brand heading deliberately has no suffix in Arabic/Chinese.
  if (typeof value === "string") return value.trim() || path.endsWith("welcome.titleAfter") ? [] : [path];
  if (Array.isArray(value)) return value.flatMap((item, i) => collect(item, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => collect(item, `${path}.${key}`));
  return [];
}

function shape(value: unknown): unknown {
  // Voice-command synonym lists intentionally differ in length by language.
  if (Array.isArray(value)) return { arrayOf: value.length ? shape(value[0]) : "empty" };
  if (typeof value === "function") return "function";
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, shape(item)]));
  return typeof value;
}

describe("Basira internationalization", () => {
  it("uses Arabic RTL, English LTR and Chinese LTR with correct speech tags", () => {
    expect(LANGS).toEqual(["ar", "en", "zh-CN"]);
    expect(LANG_META.ar).toMatchObject({ dir: "rtl", speechLang: "ar-SA" });
    expect(LANG_META.en).toMatchObject({ dir: "ltr", speechLang: "en-US" });
    expect(LANG_META["zh-CN"]).toMatchObject({ dir: "ltr", speechLang: "zh-CN" });
    expect(normalizeLang("zh-Hans-CN")).toBe("zh-CN");
  });

  for (const [name, messages] of Object.entries(namespaces)) {
    it(`has nonempty matching ar/en/zh-CN messages for ${name}`, () => {
      expect(messages).toHaveProperty("ar");
      expect(messages).toHaveProperty("en");
      expect(messages).toHaveProperty("zh-CN");
      expect(shape(messages.en)).toEqual(shape(messages.ar));
      expect(shape(messages["zh-CN"])).toEqual(shape(messages.ar));
      expect(collect(messages.ar)).toEqual([]);
      expect(collect(messages.en)).toEqual([]);
      expect(collect(messages["zh-CN"])).toEqual([]);
    });
  }
});
