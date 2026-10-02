import { defineMessages } from "../define";

/** Strings for the AI Guide page. */
export const aiGuideMessages = defineMessages({
  ar: {
    hero: {
      badge: "مساعد ذكي متقدم",
      title: "مساعدك الشامل في بصيرة",
      description: "نظام ذكي يعمل مثل ChatGPT، يرشدك خطوة بخطوة ويجيب على جميع أسئلتك حول المنصة والاختبارات.",
    },
    welcome: {
      message: `مرحباً بك في مساعد بصيرة الذكي! 👋

أنا هنا لمساعدتك في كل شيء يتعلق بمنصة بصيرة. يمكنني:

✅ شرح كيفية استخدام المنصة خطوة بخطوة
✅ تقديم نصائح عملية لتحسين أدائك
✅ حل المشاكل التقنية والأسئلة
✅ إرشادك خلال عملية الاختبار بالكامل

اسأل عن أي شيء تريده، وسأقدم لك إجابة مفصلة وواضحة!`,
    },
    languages: {
      ar: "العربية",
      en: "الإنجليزية",
      zhCN: "الصينية المبسطة",
    },
    chat: {
      title: "مساعد بصيرة الذكي",
      subtitle: "يعمل بالذكاء الاصطناعي المتقدم",
      languageSelectorLabel: "تغيير لغة المحادثة",
      languageSelectorTitle: (name: string) => `اضغط للتبديل إلى ${name}`,
      autoSpeakOn: "صوت مفعّل",
      autoSpeakOff: "صوت متوقف",
      enableAutoSpeak: "تفعيل القراءة التلقائية",
      disableAutoSpeak: "إيقاف القراءة التلقائية",
      readMessage: "قراءة الرسالة",
      readMessageAction: "استمع",
      stopReadingAction: "إيقاف",
      copyMessage: "نسخ الرسالة",
      copyAction: "نسخ",
      copiedAction: "تم النسخ",
      thinking: "جاري التفكير...",
      suggestedTopics: "مواضيع مقترحة:",
      startListening: "بدء الاستماع",
      stopListening: "إيقاف الاستماع",
      listeningPlaceholder: "جاري الاستماع...",
      messagePlaceholder: "اسأل عن أي شيء...",
      messageInputLabel: "حقل إدخال السؤال",
      sendMessage: "إرسال السؤال",
    },
    suggestions: [
      { label: "كيف أبدأ الاختبار؟", action: "شرح لي خطوات البدء بالاختبار بالتفصيل" },
      { label: "شرح المميزات", action: "اشرح لي جميع مميزات منصة بصيرة بشكل مفصل" },
      { label: "نصائح للنجاح", action: "أعطني نصائح عملية لتحقيق أفضل أداء في الاختبارات" },
      { label: "مساعدة تقنية", action: "ساعدني في حل المشاكل التقنية والأخطاء" },
    ],
    errors: {
      connectionFailed: "فشل في الاتصال",
      unableToProcess: "عذراً، لم أتمكن من معالجة طلبك",
      connectionError: "عذراً، حدث خطأ في الاتصال",
    },
    toasts: {
      startSpeaking: "تحدث الآن...",
      autoSpeakDisabled: "تم إيقاف القراءة التلقائية",
      autoSpeakEnabled: "تم تفعيل القراءة التلقائية",
      languageSwitched: (name: string) => `تم التبديل إلى ${name}`,
      copied: "تم النسخ",
    },
  },
  en: {
    hero: {
      badge: "Advanced AI Assistant",
      title: "Your Complete Basira Guide",
      description: "An intelligent system like ChatGPT that guides you step by step and answers all your questions about the platform and exams.",
    },
    welcome: {
      message: `Welcome to the Basira AI Assistant! 👋

I am here to help with everything related to the Basira platform. I can:

✅ Explain how to use the platform step by step
✅ Share practical tips to improve your performance
✅ Solve technical issues and answer questions
✅ Guide you through the entire exam process

Ask me anything, and I will give you a clear, detailed answer!`,
    },
    languages: {
      ar: "Arabic",
      en: "English",
      zhCN: "Simplified Chinese",
    },
    chat: {
      title: "Basira AI Assistant",
      subtitle: "Powered by advanced AI",
      languageSelectorLabel: "Change chat language",
      languageSelectorTitle: (name: string) => `Click to switch to ${name}`,
      autoSpeakOn: "Sound on",
      autoSpeakOff: "Sound off",
      enableAutoSpeak: "Enable auto-speak",
      disableAutoSpeak: "Disable auto-speak",
      readMessage: "Read message aloud",
      readMessageAction: "Listen",
      stopReadingAction: "Stop",
      copyMessage: "Copy message",
      copyAction: "Copy",
      copiedAction: "Copied",
      thinking: "Thinking...",
      suggestedTopics: "Suggested topics:",
      startListening: "Start listening",
      stopListening: "Stop listening",
      listeningPlaceholder: "Listening...",
      messagePlaceholder: "Ask anything...",
      messageInputLabel: "Question input field",
      sendMessage: "Send question",
    },
    suggestions: [
      { label: "How do I start an exam?", action: "Explain the steps to start an exam in detail" },
      { label: "Explain the features", action: "Explain all features of the Basira platform in detail" },
      { label: "Tips for success", action: "Give me practical tips to achieve the best performance in exams" },
      { label: "Technical help", action: "Help me solve technical issues and errors" },
    ],
    errors: {
      connectionFailed: "Connection failed",
      unableToProcess: "Sorry, I couldn't process your request",
      connectionError: "Sorry, there was a connection error",
    },
    toasts: {
      startSpeaking: "Start speaking...",
      autoSpeakDisabled: "Auto-speak disabled",
      autoSpeakEnabled: "Auto-speak enabled",
      languageSwitched: (name: string) => `Switched to ${name}`,
      copied: "Copied!",
    },
  },
  "zh-CN": {
    hero: {
      badge: "高级 AI 助手",
      title: "你的 Basira 全方位指南",
      description: "像 ChatGPT 一样的智能系统，逐步为你提供指导，并解答你关于平台和考试的所有问题。",
    },
    welcome: {
      message: `欢迎使用 Basira AI 助手！👋

我会帮助你处理与 Basira 平台相关的一切事务。我可以：

✅ 逐步讲解如何使用平台
✅ 分享提升表现的实用建议
✅ 解决技术问题并回答疑问
✅ 指导你完成整个考试流程

你可以询问任何问题，我会为你提供清晰、详细的回答！`,
    },
    languages: {
      ar: "阿拉伯语",
      en: "英语",
      zhCN: "简体中文",
    },
    chat: {
      title: "Basira AI 助手",
      subtitle: "由先进人工智能驱动",
      languageSelectorLabel: "更改对话语言",
      languageSelectorTitle: (name: string) => `点击切换为${name}`,
      autoSpeakOn: "语音已开启",
      autoSpeakOff: "语音已关闭",
      enableAutoSpeak: "开启自动朗读",
      disableAutoSpeak: "关闭自动朗读",
      readMessage: "朗读消息",
      readMessageAction: "聆听",
      stopReadingAction: "停止",
      copyMessage: "复制消息",
      copyAction: "复制",
      copiedAction: "已复制",
      thinking: "正在思考...",
      suggestedTopics: "推荐主题：",
      startListening: "开始聆听",
      stopListening: "停止聆听",
      listeningPlaceholder: "正在聆听...",
      messagePlaceholder: "可以问我任何问题...",
      messageInputLabel: "问题输入框",
      sendMessage: "发送问题",
    },
    suggestions: [
      { label: "如何开始考试？", action: "请详细说明开始考试的步骤" },
      { label: "介绍平台功能", action: "请详细介绍 Basira 平台的所有功能" },
      { label: "成功小贴士", action: "请给我一些在考试中取得最佳表现的实用建议" },
      { label: "技术帮助", action: "请帮助我解决技术问题和错误" },
    ],
    errors: {
      connectionFailed: "连接失败",
      unableToProcess: "抱歉，无法处理你的请求",
      connectionError: "抱歉，连接时出现错误",
    },
    toasts: {
      startSpeaking: "请开始说话...",
      autoSpeakDisabled: "已关闭自动朗读",
      autoSpeakEnabled: "已开启自动朗读",
      languageSwitched: (name: string) => `已切换为${name}`,
      copied: "已复制！",
    },
  },
});
