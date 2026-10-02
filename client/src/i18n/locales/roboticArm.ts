import { defineMessages } from "../define";

export const roboticArmMessages = defineMessages({
  ar: {
    hero: {
      badge: "الذراع الروبوتية",
      title: "الكتابة الآلية على الورق",
      description: "تكامل ذكي مع ذراع روبوتية تكتب إجاباتك فعلياً على ورقة الاختبار بخط واضح ومنظم.",
    },
    status: {
      disconnected: {
        label: "غير متصل بالذراع الروبوتية",
        description: "الذراع الروبوتية غير موصلة حالياً",
      },
      connecting: {
        label: "جاري الاتصال بالذراع...",
        description: "يتم البحث عن الذراع الروبوتية...",
      },
      connected: {
        label: "تم الاتصال بالذراع بنجاح",
        description: "الذراع جاهزة للكتابة",
      },
    },
    connect: {
      button: "محاولة الاتصال",
      connecting: "جاري الاتصال",
      errorTitle: "الذراع الروبوتية غير موصلة",
      errorDescription: "تأكد من توصيل الذراع الروبوتية بالجهاز وتشغيلها، ثم حاول مرة أخرى.",
    },
    instructions: {
      title: "تعليمات التوصيل:",
      items: ["تأكد من تشغيل الذراع الروبوتية", "قم بتوصيلها عبر البلوتوث أو USB", "اضغط على \"محاولة الاتصال\""],
    },
    workflow: {
      imageAlt: "الذراع الروبوتية الذكية تكتب على ورقة الاختبار",
      title: "كيف تعمل الذراع الروبوتية؟",
      steps: [
        { title: "إدخال الإجابة", description: "يتحدث الكفيف أو يكتب إجابته داخل التطبيق." },
        { title: "تحليل وتنظيم", description: "يقوم الذكاء الاصطناعي بتحليل الإجابة وتنظيمها." },
        { title: "إرسال الأوامر", description: "يتم إرسال أوامر دقيقة إلى الذراع الروبوتية." },
        { title: "الكتابة على الورق", description: "تبدأ الذراع بكتابة الإجابات بخط واضح ومنظم." },
      ],
    },
    controls: {
      badge: "التحكم",
      title: "إعدادات الذراع الروبوتية",
      description: "تحكم كامل في إعدادات الكتابة لتناسب احتياجاتك.",
      items: [
        { title: "سرعة الكتابة", description: "تحكم بسرعة الكتابة حسب الحاجة" },
        { title: "حجم الخط", description: "اختر حجم الخط المناسب" },
        { title: "مكان الكتابة", description: "تحديد تلقائي لمكان الإجابة" },
        { title: "إعدادات متقدمة", description: "تخصيص كامل لتجربة الكتابة" },
      ],
    },
  },
  en: {
    hero: {
      badge: "Robotic arm",
      title: "Automated writing on paper",
      description: "Smart integration with a robotic arm that writes your answers directly on the exam paper in a clear, organized hand.",
    },
    status: {
      disconnected: {
        label: "Robotic arm disconnected",
        description: "The robotic arm is currently disconnected",
      },
      connecting: {
        label: "Connecting to the arm...",
        description: "Searching for the robotic arm...",
      },
      connected: {
        label: "Arm connected successfully",
        description: "The arm is ready to write",
      },
    },
    connect: {
      button: "Try to connect",
      connecting: "Connecting",
      errorTitle: "Robotic arm disconnected",
      errorDescription: "Make sure the robotic arm is connected to your device and powered on, then try again.",
    },
    instructions: {
      title: "Connection instructions:",
      items: ["Make sure the robotic arm is powered on", "Connect it via Bluetooth or USB", "Press \"Try to connect\""],
    },
    workflow: {
      imageAlt: "Smart robotic arm writing on an exam paper",
      title: "How does the robotic arm work?",
      steps: [
        { title: "Enter the answer", description: "The blind student speaks or types the answer in the app." },
        { title: "Analyze and organize", description: "AI analyzes and organizes the answer." },
        { title: "Send commands", description: "Precise commands are sent to the robotic arm." },
        { title: "Write on paper", description: "The arm begins writing the answers clearly and neatly." },
      ],
    },
    controls: {
      badge: "Controls",
      title: "Robotic arm settings",
      description: "Full control over writing settings to suit your needs.",
      items: [
        { title: "Writing speed", description: "Adjust the writing speed as needed" },
        { title: "Font size", description: "Choose the appropriate font size" },
        { title: "Writing position", description: "Automatically determine where to write the answer" },
        { title: "Advanced settings", description: "Fully customize your writing experience" },
      ],
    },
  },
  "zh-CN": {
    hero: {
      badge: "机械臂",
      title: "在纸上自动书写",
      description: "智能连接机械臂，将你的答案直接清晰、有序地写在试卷上。",
    },
    status: {
      disconnected: {
        label: "机械臂未连接",
        description: "机械臂当前未连接",
      },
      connecting: {
        label: "正在连接机械臂……",
        description: "正在搜索机械臂……",
      },
      connected: {
        label: "机械臂已成功连接",
        description: "机械臂已准备好书写",
      },
    },
    connect: {
      button: "尝试连接",
      connecting: "正在连接",
      errorTitle: "机械臂未连接",
      errorDescription: "请确认机械臂已连接到设备并已开机，然后重试。",
    },
    instructions: {
      title: "连接说明：",
      items: ["确认机械臂已开机", "通过蓝牙或 USB 连接机械臂", "按下“尝试连接”"],
    },
    workflow: {
      imageAlt: "智能机械臂正在试卷上书写",
      title: "机械臂如何工作？",
      steps: [
        { title: "输入答案", description: "视障学生在应用中说出或输入答案。" },
        { title: "分析与整理", description: "人工智能会分析并整理答案。" },
        { title: "发送指令", description: "系统向机械臂发送精确指令。" },
        { title: "在纸上书写", description: "机械臂开始清晰、整齐地书写答案。" },
      ],
    },
    controls: {
      badge: "控制",
      title: "机械臂设置",
      description: "全面控制书写设置，满足你的使用需求。",
      items: [
        { title: "书写速度", description: "按需调节书写速度" },
        { title: "字体大小", description: "选择合适的字体大小" },
        { title: "书写位置", description: "自动确定答案的书写位置" },
        { title: "高级设置", description: "全面定制书写体验" },
      ],
    },
  },
});
