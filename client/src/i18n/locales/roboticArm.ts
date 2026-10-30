import { defineMessages } from "../define";

export const roboticArmMessages = defineMessages({
  ar: {
    hero: {
      badge: "الذراع الروبوتية",
      title: "تصوّر للكتابة الآلية على الورق",
      description: "واجهة تعريفية لفكرة الذراع الروبوتية. بروتوكول الاتصال ونقل أوامر الكتابة غير منفّذين في هذه النسخة.",
    },
    status: {
      disconnected: {
        label: "تكامل الذراع غير متاح",
        description: "لا تبحث هذه النسخة عن جهاز ولا تتصل عبر Bluetooth أو USB ولا ترسل أوامر كتابة.",
      },
    },
    connect: {
      button: "الاتصال غير منفّذ",
    },
    instructions: {
      title: "متطلبات تنفيذ التكامل لاحقًا:",
      items: ["تحديد جهاز وبروتوكول اتصال متوافقين", "تنفيذ نقل أوامر الكتابة والتحقق من الاستجابة", "اختبارات جهاز بإشراف قبل تمكين أي تحكم"],
    },
    workflow: {
      imageAlt: "الذراع الروبوتية الذكية تكتب على ورقة الاختبار",
      title: "سير عمل مقترح — غير منفّذ",
      steps: [
        { title: "إدخال الإجابة", description: "يتحدث الكفيف أو يكتب إجابته داخل التطبيق." },
        { title: "تحليل وتنظيم", description: "يقوم الذكاء الاصطناعي بتحليل الإجابة وتنظيمها." },
        { title: "إرسال الأوامر", description: "سيتطلب إرسال الأوامر تنفيذ بروتوكول الجهاز والتحقق منه." },
        { title: "الكتابة على الورق", description: "الكتابة الفعلية غير متاحة قبل تنفيذ تكامل الجهاز واختباره." },
      ],
    },
    controls: {
      badge: "التحكم",
      title: "إعدادات مقترحة للذراع",
      description: "بطاقات تعريفية فقط؛ لا توجد أدوات تحكم فعّالة بالجهاز.",
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
      title: "A concept for automated writing on paper",
      description: "An informational robotic-arm concept. Device transport and writing commands are not implemented in this build.",
    },
    status: {
      disconnected: {
        label: "Robotic-arm integration unavailable",
        description: "This build does not scan for devices, connect over Bluetooth or USB, or send writing commands.",
      },
    },
    connect: {
      button: "Connection not implemented",
    },
    instructions: {
      title: "Requirements for future integration:",
      items: ["Identify a compatible device and communication protocol", "Implement writing commands and verify responses", "Run supervised hardware tests before enabling control"],
    },
    workflow: {
      imageAlt: "Smart robotic arm writing on an exam paper",
      title: "Proposed workflow — not implemented",
      steps: [
        { title: "Enter the answer", description: "The blind student speaks or types the answer in the app." },
        { title: "Analyze and organize", description: "AI analyzes and organizes the answer." },
        { title: "Send commands", description: "Sending commands requires an implemented and verified device protocol." },
        { title: "Write on paper", description: "Physical writing is unavailable until device integration is implemented and tested." },
      ],
    },
    controls: {
      badge: "Controls",
      title: "Proposed arm settings",
      description: "Informational cards only. No working hardware controls are available.",
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
      title: "纸上自动书写概念",
      description: "机械臂功能介绍。当前版本尚未实现设备通信或书写指令。",
    },
    status: {
      disconnected: {
        label: "机械臂集成不可用",
        description: "此版本不会搜索设备，不会通过蓝牙或 USB 连接，也不会发送书写指令。",
      },
    },
    connect: {
      button: "尚未实现连接",
    },
    instructions: {
      title: "后续集成要求：",
      items: ["确定兼容设备及通信协议", "实现书写指令并验证设备响应", "启用控制前进行有人监督的硬件测试"],
    },
    workflow: {
      imageAlt: "智能机械臂正在试卷上书写",
      title: "建议流程 — 尚未实现",
      steps: [
        { title: "输入答案", description: "视障学生在应用中说出或输入答案。" },
        { title: "分析与整理", description: "人工智能会分析并整理答案。" },
        { title: "发送指令", description: "需要先实现并验证设备通信协议。" },
        { title: "在纸上书写", description: "设备集成完成并通过测试前无法进行实际书写。" },
      ],
    },
    controls: {
      badge: "控制",
      title: "建议机械臂设置",
      description: "仅为功能介绍卡片，尚无可用的硬件控制。",
      items: [
        { title: "书写速度", description: "按需调节书写速度" },
        { title: "字体大小", description: "选择合适的字体大小" },
        { title: "书写位置", description: "自动确定答案的书写位置" },
        { title: "高级设置", description: "全面定制书写体验" },
      ],
    },
  },
});
