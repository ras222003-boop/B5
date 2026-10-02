import { defineMessages } from "../define";

/** Home page hero, service overview, accessibility information and calls to action. */
export const homeMessages = defineMessages({
  ar: {
    hero: {
      eyebrow: "منصة بصيرة بهوية Aurum Nexus",
      titleBefore: "اختبر ",
      titleHighlight: "باستقلالية",
      titleAfter: "دون الحاجة لمرافق",
      description: "منصة بصيرة تُمكّن الطلاب من ذوي الإعاقة البصرية من أداء اختباراتهم بشكل مستقل عبر الذكاء الاصطناعي والتقنيات المساعدة.",
      tryNow: "جرّب الآن",
      howItWorks: "كيف تعمل؟",
      aboutUs: "من نحن",
      readAloud: "مرحباً بك في منصة بصيرة. هذه المنصة تُمكّن الطلاب من ذوي الإعاقة البصرية من أداء اختباراتهم بشكل مستقل. يمكنك مسح ورقة الاختبار بالكاميرا، وسيتم قراءة الأسئلة لك بالصوت، ثم تجيب بصوتك أو بالكتابة. اضغط على جرّب الآن للبدء.",
      listenAriaLabel: "استمع لوصف المنصة",
      listen: "استمع",
      stop: "إيقاف",
      imageAlt: "طالب كفيف يستخدم منصة بصيرة لأداء اختبار عبر الجهاز اللوحي",
      brandLabel: "AURUM NEXUS",
    },
    voiceGuide: {
      title: "المرشد الصوتي متاح دائماً",
      description: "اضغط على زر المرشد الصوتي في أسفل الشاشة للتنقل بالصوت أو الاستماع لوصف الصفحة",
      examCommand: "قل: \"الاختبار\" للانتقال",
      helpCommand: "قل: \"مساعدة\" للإرشاد",
    },
    stats: [
      { value: "100%", label: "استقلالية تامة" },
      { value: "OCR", label: "تعرف ضوئي متقدم" },
      { value: "AI", label: "ذكاء اصطناعي" },
      { value: "PDF", label: "تصدير فوري" },
    ],
    featuresSection: {
      badge: "المميزات",
      title: "كل ما يحتاجه الطالب الكفيف",
      description: "مجموعة متكاملة من الأدوات والتقنيات المصممة خصيصاً لتمكين ذوي الإعاقة البصرية من أداء اختباراتهم باستقلالية.",
      supportPrompt: "هل تحتاج مساعدة لاستخدام أي خدمة؟",
      supportLink: "اذهب إلى الدعم الفني",
    },
    features: [
      {
        title: "قراءة الاختبار بالكاميرا",
        description: "وجّه كاميرا جوالك نحو ورقة الاختبار وسيتم التعرف على الأسئلة تلقائياً عبر تقنية OCR المتقدمة.",
      },
      {
        title: "تحويل النص إلى صوت",
        description: "يتم قراءة الأسئلة بصوت عربي وإنجليزي واضح وطبيعي، مع إمكانية التحكم بسرعة القراءة.",
      },
      {
        title: "الإجابة بالصوت",
        description: "أجب على الأسئلة بصوتك وسيتم تحويل كلامك إلى نص مكتوب بدقة عالية.",
      },
      {
        title: "الذراع الروبوتية",
        description: "تكامل مع ذراع روبوتية ذكية تكتب إجاباتك على الورق بخط واضح ومنظم.",
      },
      {
        title: "تصدير PDF مع التصحيح",
        description: "بعد الانتهاء، يتم تجميع إجاباتك مع نتائج التصحيح الذكي في ملف PDF جاهز للطباعة.",
      },
      {
        title: "واجهة سهلة الوصول",
        description: "واجهة مصممة خصيصاً للمكفوفين مع دعم كامل للأوامر الصوتية والتنقل الذكي.",
      },
      {
        title: "دعم فني مع متابعة",
        description: "محادثة دعم ذكية تقترح خطوات عملية، وتذكرة متابعة إذا لم تُحل المشكلة.",
      },
    ],
    accessibilitySection: {
      badge: "إمكانية الوصول",
      title: "برامج المساعدة والمساندة",
      description: "منصة بصيرة مصممة لتكون متوافقة مع جميع برامج ومساعدات إمكانية الوصول المعتمدة عالمياً.",
    },
    accessibilityTools: [
      {
        name: "قارئ الشاشة",
        subtitle: "Screen Reader",
        description: "متوافق مع NVDA وJAWS وVoiceOver وTalkBack",
      },
      {
        name: "التنقل بلوحة المفاتيح",
        subtitle: "Keyboard Navigation",
        description: "دعم كامل للتنقل بمفاتيح Tab والأسهم وEnter",
      },
      {
        name: "التحكم الصوتي",
        subtitle: "Voice Control",
        description: "أوامر صوتية بالعربية والإنجليزية للتنقل والإجابة",
      },
      {
        name: "دعم الجوال واللوحي",
        subtitle: "Mobile & Tablet",
        description: "متوافق مع iOS وAndroid وجميع أحجام الشاشات",
      },
      {
        name: "ثنائي اللغة",
        subtitle: "Bilingual",
        description: "دعم كامل للعربية والإنجليزية مع كشف تلقائي للغة",
      },
      {
        name: "تكبير النص",
        subtitle: "Text Zoom",
        description: "متوافق مع تكبير المتصفح وإعدادات إمكانية الوصول",
      },
      {
        name: "التنقل اللمسي",
        subtitle: "Touch Navigation",
        description: "أزرار كبيرة ومساحات لمس واسعة مناسبة لضعاف البصر",
      },
      {
        name: "وضع التباين العالي",
        subtitle: "High Contrast",
        description: "متوافق مع وضع التباين العالي في أنظمة التشغيل",
      },
    ],
    screenReaders: {
      title: "قارئات الشاشة المدعومة",
      description: "متوافق مع جميع قارئات الشاشة الرئيسية",
      items: [
        { name: "NVDA", platform: "Windows" },
        { name: "JAWS", platform: "Windows" },
        { name: "VoiceOver", platform: "iOS / macOS" },
        { name: "TalkBack", platform: "Android" },
        { name: "Narrator", platform: "Windows" },
        { name: "Orca", platform: "Linux" },
      ],
    },
    wcag: {
      title: "متوافق مع معايير WCAG 2.1",
      description: "تلتزم المنصة بمعايير إمكانية الوصول العالمية (WCAG 2.1 Level AA)، مما يضمن تجربة شاملة لجميع المستخدمين بغض النظر عن قدراتهم.",
    },
    goalsSection: {
      badge: "أهدافنا",
      title: "نحو تعليم شامل ومتاح للجميع",
    },
    goals: [
      {
        title: "تمكين ذوي الإعاقة",
        description: "تمكين ذوي الإعاقة البصرية من أداء الاختبارات باستقلالية تامة دون تدخل بشري.",
      },
      {
        title: "بيئة عادلة وآمنة",
        description: "توفير بيئة اختبار عادلة وشاملة تحفظ خصوصية الطالب وكرامته.",
      },
      {
        title: "دعم التحول الرقمي",
        description: "دمج الذكاء الاصطناعي مع التقنيات المساعدة لخدمة التعليم الشامل.",
      },
    ],
    cta: {
      title: "ابدأ تجربتك الآن",
      description: "جرّب منصة بصيرة واكتشف كيف يمكن للتقنية أن تُمكّن ذوي الإعاقة البصرية من أداء اختباراتهم باستقلالية.",
      examDemo: "تجربة الاختبار",
      onlineExams: "الاختبارات الإلكترونية",
    },
  },
  en: {
    hero: {
      eyebrow: "Basira, powered by Aurum Nexus",
      titleBefore: "Take exams ",
      titleHighlight: "independently",
      titleAfter: "without needing an assistant",
      description: "Basira enables students with visual impairments to take their exams independently through artificial intelligence and assistive technology.",
      tryNow: "Try it now",
      howItWorks: "How does it work?",
      aboutUs: "About us",
      readAloud: "Welcome to Basira. This platform enables students with visual impairments to take their exams independently. You can scan an exam paper with the camera, have the questions read aloud, then answer by voice or typing. Select Try it now to begin.",
      listenAriaLabel: "Listen to a description of the platform",
      listen: "Listen",
      stop: "Stop",
      imageAlt: "A blind student using Basira on a tablet to take an exam",
      brandLabel: "AURUM NEXUS",
    },
    voiceGuide: {
      title: "The voice guide is always available",
      description: "Use the voice-guide button at the bottom of the screen to navigate by voice or hear a description of this page.",
      examCommand: "Say: \"exam\" to navigate",
      helpCommand: "Say: \"help\" for guidance",
    },
    stats: [
      { value: "100%", label: "Full independence" },
      { value: "OCR", label: "Advanced optical recognition" },
      { value: "AI", label: "Artificial intelligence" },
      { value: "PDF", label: "Instant export" },
    ],
    featuresSection: {
      badge: "Features",
      title: "Everything a blind student needs",
      description: "A complete set of tools and technologies designed specifically to help people with visual impairments take exams independently.",
      supportPrompt: "Need help using a service?",
      supportLink: "Go to technical support",
    },
    features: [
      {
        title: "Read an exam with the camera",
        description: "Point your phone camera at the exam paper and questions are recognized automatically with advanced OCR technology.",
      },
      {
        title: "Text to speech",
        description: "Questions are read aloud in clear, natural speech, with adjustable reading speed.",
      },
      {
        title: "Answer by voice",
        description: "Answer questions with your voice and your speech is converted accurately into written text.",
      },
      {
        title: "Robotic arm",
        description: "Integrates with an intelligent robotic arm that writes your answers clearly and neatly on paper.",
      },
      {
        title: "Export a corrected PDF",
        description: "When you finish, your answers and smart-marking results are compiled into a print-ready PDF.",
      },
      {
        title: "Accessible interface",
        description: "An interface designed specifically for blind users, with full support for voice commands and smart navigation.",
      },
      {
        title: "AI technical support with follow-up",
        description: "An intelligent support chat suggests practical steps and creates a follow-up ticket if the issue remains unresolved.",
      },
    ],
    accessibilitySection: {
      badge: "Accessibility",
      title: "Assistive programs and support",
      description: "Basira is designed to work with internationally recognized accessibility software and assistive tools.",
    },
    accessibilityTools: [
      {
        name: "Screen reader",
        subtitle: "Screen Reader",
        description: "Compatible with NVDA, JAWS, VoiceOver and TalkBack",
      },
      {
        name: "Keyboard navigation",
        subtitle: "Keyboard Navigation",
        description: "Full navigation support with Tab, arrow and Enter keys",
      },
      {
        name: "Voice control",
        subtitle: "Voice Control",
        description: "Voice commands in Arabic, English and Simplified Chinese for navigation and answering",
      },
      {
        name: "Mobile and tablet support",
        subtitle: "Mobile & Tablet",
        description: "Compatible with iOS, Android and every screen size",
      },
      {
        name: "Multilingual",
        subtitle: "Multilingual",
        description: "Full Arabic, English and Simplified Chinese support with automatic language detection",
      },
      {
        name: "Text zoom",
        subtitle: "Text Zoom",
        description: "Compatible with browser zoom and accessibility settings",
      },
      {
        name: "Touch navigation",
        subtitle: "Touch Navigation",
        description: "Large buttons and spacious touch targets suited to people with low vision",
      },
      {
        name: "High contrast mode",
        subtitle: "High Contrast",
        description: "Compatible with operating-system high contrast mode",
      },
    ],
    screenReaders: {
      title: "Supported screen readers",
      description: "Compatible with all major screen readers",
      items: [
        { name: "NVDA", platform: "Windows" },
        { name: "JAWS", platform: "Windows" },
        { name: "VoiceOver", platform: "iOS / macOS" },
        { name: "TalkBack", platform: "Android" },
        { name: "Narrator", platform: "Windows" },
        { name: "Orca", platform: "Linux" },
      ],
    },
    wcag: {
      title: "Conforms to WCAG 2.1 standards",
      description: "The platform follows global accessibility standards (WCAG 2.1 Level AA), supporting an inclusive experience for all users regardless of ability.",
    },
    goalsSection: {
      badge: "Our goals",
      title: "Towards inclusive education that is accessible to everyone",
    },
    goals: [
      {
        title: "Empowering people with disabilities",
        description: "Enable people with visual impairments to take exams with complete independence and no human intervention.",
      },
      {
        title: "A fair, secure environment",
        description: "Provide a fair, inclusive exam environment that protects each student's privacy and dignity.",
      },
      {
        title: "Supporting digital transformation",
        description: "Bring artificial intelligence together with assistive technology in service of inclusive education.",
      },
    ],
    cta: {
      title: "Start your experience now",
      description: "Try Basira and discover how technology can enable people with visual impairments to take exams independently.",
      examDemo: "Try the exam",
      onlineExams: "Online exams",
    },
  },
  "zh-CN": {
    hero: {
      eyebrow: "Basira，由 Aurum Nexus 打造",
      titleBefore: "独立 ",
      titleHighlight: "参加考试",
      titleAfter: "无需陪同人员",
      description: "Basira 借助人工智能和辅助技术，帮助视障学生独立完成考试。",
      tryNow: "立即体验",
      howItWorks: "如何运作？",
      aboutUs: "关于我们",
      readAloud: "欢迎来到 Basira。该平台帮助视障学生独立完成考试。您可以用相机扫描试卷，系统会朗读题目；随后您可以通过语音或键盘作答。请选择“立即体验”开始。",
      listenAriaLabel: "聆听平台介绍",
      listen: "聆听",
      stop: "停止",
      imageAlt: "一名盲人学生使用平板电脑上的 Basira 参加考试",
      brandLabel: "AURUM NEXUS",
    },
    voiceGuide: {
      title: "语音引导始终可用",
      description: "使用屏幕底部的语音引导按钮，通过语音导航或聆听本页面介绍。",
      examCommand: "说“考试”即可导航",
      helpCommand: "说“帮助”即可获得引导",
    },
    stats: [
      { value: "100%", label: "完全独立" },
      { value: "OCR", label: "先进光学识别" },
      { value: "AI", label: "人工智能" },
      { value: "PDF", label: "即时导出" },
    ],
    featuresSection: {
      badge: "功能",
      title: "盲人学生所需的一切",
      description: "一套完整的工具与技术，专为帮助视障人士独立完成考试而设计。",
      supportPrompt: "需要帮助使用某项服务吗？",
      supportLink: "前往技术支持",
    },
    features: [
      {
        title: "通过相机读取试卷",
        description: "将手机相机对准试卷，系统会借助先进 OCR 技术自动识别题目。",
      },
      {
        title: "文本转语音",
        description: "以清晰自然的语音朗读题目，并可调节朗读速度。",
      },
      {
        title: "语音作答",
        description: "用语音回答题目，系统会高精度地将您的语音转换为书面文本。",
      },
      {
        title: "机械臂",
        description: "可与智能机械臂集成，由它清晰、整齐地将您的答案写在纸上。",
      },
      {
        title: "导出带批改结果的 PDF",
        description: "完成后，您的答案和智能批改结果会汇总为可直接打印的 PDF 文件。",
      },
      {
        title: "无障碍界面",
        description: "专为盲人用户设计的界面，全面支持语音命令和智能导航。",
      },
      {
        title: "AI 技术支持与跟进",
        description: "智能支持对话会建议可行步骤；若问题仍未解决，将创建跟进工单。",
      },
    ],
    accessibilitySection: {
      badge: "无障碍访问",
      title: "辅助程序与支持",
      description: "Basira 的设计可兼容全球认可的无障碍软件和辅助工具。",
    },
    accessibilityTools: [
      {
        name: "屏幕阅读器",
        subtitle: "Screen Reader",
        description: "兼容 NVDA、JAWS、VoiceOver 和 TalkBack",
      },
      {
        name: "键盘导航",
        subtitle: "Keyboard Navigation",
        description: "全面支持使用 Tab、方向键和 Enter 键导航",
      },
      {
        name: "语音控制",
        subtitle: "Voice Control",
        description: "支持使用阿拉伯语、英语和简体中文语音命令导航和作答",
      },
      {
        name: "手机与平板支持",
        subtitle: "Mobile & Tablet",
        description: "兼容 iOS、Android 及各种屏幕尺寸",
      },
      {
        name: "多语言",
        subtitle: "Multilingual",
        description: "全面支持阿拉伯语、英语和简体中文，并可自动检测语言",
      },
      {
        name: "文字缩放",
        subtitle: "Text Zoom",
        description: "兼容浏览器缩放和无障碍设置",
      },
      {
        name: "触控导航",
        subtitle: "Touch Navigation",
        description: "大按钮和宽裕的触控区域，适合低视力用户",
      },
      {
        name: "高对比度模式",
        subtitle: "High Contrast",
        description: "兼容操作系统的高对比度模式",
      },
    ],
    screenReaders: {
      title: "支持的屏幕阅读器",
      description: "兼容所有主流屏幕阅读器",
      items: [
        { name: "NVDA", platform: "Windows" },
        { name: "JAWS", platform: "Windows" },
        { name: "VoiceOver", platform: "iOS / macOS" },
        { name: "TalkBack", platform: "Android" },
        { name: "Narrator", platform: "Windows" },
        { name: "Orca", platform: "Linux" },
      ],
    },
    wcag: {
      title: "符合 WCAG 2.1 标准",
      description: "平台遵循全球无障碍标准（WCAG 2.1 AA 级），确保所有用户无论能力如何都能获得包容的使用体验。",
    },
    goalsSection: {
      badge: "我们的目标",
      title: "迈向人人可及的包容性教育",
    },
    goals: [
      {
        title: "赋能残障人士",
        description: "帮助视障人士完全独立地完成考试，无需他人介入。",
      },
      {
        title: "公平、安全的环境",
        description: "提供公平、包容的考试环境，保护学生的隐私与尊严。",
      },
      {
        title: "支持数字化转型",
        description: "将人工智能与辅助技术相结合，服务于包容性教育。",
      },
    ],
    cta: {
      title: "立即开启您的体验",
      description: "体验 Basira，了解技术如何帮助视障人士独立完成考试。",
      examDemo: "体验考试",
      onlineExams: "在线考试",
    },
  },
});
