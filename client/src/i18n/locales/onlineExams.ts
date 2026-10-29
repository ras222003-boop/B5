import { defineMessages } from "../define";

export const onlineExamsMessages = defineMessages({
  ar: {
    hero: {
      title: "الاختبارات الإلكترونية",
      description: "ربط منصات الاختبارات الخارجية غير متاح في هذه النسخة. يمكنك تجربة قراءة صورة اختبار والإجابة عليها في تجربة بصيرة.",
    },
    exam: {
      enterUrl: "ربط اختبار خارجي — غير متاح",
      urlPlaceholder: "https://blackboard.university.edu/exam/...",
      urlLabel: "رابط اختبار خارجي (الربط غير متاح)",
      load: "الربط غير متاح",
      listenInstructions: "سماع التعليمات",
      unavailable: "لا تُحمّل هذه الصفحة أسئلة من Blackboard أو Moodle أو Forms، ولا تسجل إجابات فيها أو تقفل المتصفح. لا تدخل رابط اختبار حقيقي هنا.",
      localDemo: "فتح تجربة صورة اختبار",
      instructions: "ربط منصة خارجية غير منفّذ. افتح تجربة صورة اختبار، وارفع صورة تجريبية واضحة، ثم راجع النص المستخرج قبل الإجابة. تتطلب القراءة والتصحيح خدمات الخادم.",
    },
    platforms: {
      badge: "تكاملات غير منفّذة",
      title: "منصات تحتاج ربطًا مستقلًا",
      description: "القائمة للتعريف فقط؛ لا يوجد اتصال بهذه المنصات في النسخة الحالية.",
      supported: "الربط غير متاح",
      items: [
        { name: "Blackboard", description: "نظام إدارة التعلم في الجامعات" },
        { name: "Moodle", description: "منصة تعلم مفتوحة المصدر" },
        { name: "Google Forms", description: "نماذج جوجل" },
        { name: "Microsoft Forms", description: "نماذج مايكروسوفت" },
        { name: "Canvas LMS", description: "نظام إدارة التعلم Canvas" },
        { name: "أخرى", description: "منصات اختبارات خارجية أخرى" },
      ],
    },
    howItWorks: {
      badge: "المتاح للتجربة",
      title: "تجربة صورة اختبار داخل بصيرة",
      steps: [
        { title: "افتح التجربة", description: "انتقل إلى تجربة صورة اختبار باستخدام الرابط أعلاه" },
        { title: "ارفع صورة تجريبية", description: "راجع الأسئلة والنص المستخرج؛ قد تخطئ خدمة القراءة" },
        { title: "راجع إجاباتك", description: "جرّب الإدخال والتصدير المتاحين؛ لا تُرسل إجابات إلى منصة تعليمية خارجية" },
      ],
    },
  },
  en: {
    hero: {
      title: "Online exams",
      description: "External exam-platform integration is unavailable in this build. Try reading and answering an exam image in Basira's demo.",
    },
    exam: {
      enterUrl: "External exam integration — unavailable",
      urlPlaceholder: "https://blackboard.university.edu/exam/...",
      urlLabel: "External exam link (integration unavailable)",
      load: "Integration unavailable",
      listenInstructions: "Listen to instructions",
      unavailable: "This page does not load questions from Blackboard, Moodle or Forms, record answers there, or lock the browser. Do not enter a real exam link here.",
      localDemo: "Open the exam-image demo",
      instructions: "External-platform integration is not implemented. Open the exam-image demo, upload a clear test image and review the extracted text before answering. Reading and grading require server services.",
    },
    platforms: {
      badge: "Unimplemented integrations",
      title: "Platforms requiring separate integration",
      description: "This list is informational. The current build does not connect to these platforms.",
      supported: "Integration unavailable",
      items: [
        { name: "Blackboard", description: "A university learning management system" },
        { name: "Moodle", description: "An open-source learning platform" },
        { name: "Google Forms", description: "Google forms" },
        { name: "Microsoft Forms", description: "Microsoft forms" },
        { name: "Canvas LMS", description: "The Canvas learning management system" },
        { name: "Other", description: "Other external exam platforms" },
      ],
    },
    howItWorks: {
      badge: "Available to try",
      title: "Try an exam image in Basira",
      steps: [
        { title: "Open the demo", description: "Use the exam-image demo link above" },
        { title: "Upload a test image", description: "Review extracted questions and text; reading can be wrong" },
        { title: "Review your answers", description: "Try available input and export tools; no answers are sent to an external learning platform" },
      ],
    },
  },
  "zh-CN": {
    hero: {
      title: "在线考试",
      description: "当前版本尚未集成外部考试平台。您可以在 Basira 演示中尝试识别试卷图片并作答。",
    },
    exam: {
      enterUrl: "外部考试平台集成 — 不可用",
      urlPlaceholder: "https://blackboard.university.edu/exam/...",
      urlLabel: "外部考试链接（尚未集成）",
      load: "尚未集成",
      listenInstructions: "听取说明",
      unavailable: "本页不会从 Blackboard、Moodle 或 Forms 加载题目，不会向这些平台提交答案，也不会锁定浏览器。请勿在此输入真实考试链接。",
      localDemo: "打开试卷图片演示",
      instructions: "尚未集成外部平台。请打开试卷图片演示，上传清晰的测试图片，并在作答前核对识别的文字。文字识别和评分需要服务器服务。",
    },
    platforms: {
      badge: "尚未实现的集成",
      title: "需要单独集成的平台",
      description: "此列表仅供参考，当前版本并未连接这些平台。",
      supported: "尚未集成",
      items: [
        { name: "Blackboard", description: "高校学习管理系统" },
        { name: "Moodle", description: "开源学习平台" },
        { name: "Google Forms", description: "Google 表单" },
        { name: "Microsoft Forms", description: "Microsoft 表单" },
        { name: "Canvas LMS", description: "Canvas 学习管理系统" },
        { name: "其他", description: "其他外部考试平台" },
      ],
    },
    howItWorks: {
      badge: "可以尝试",
      title: "在 Basira 中试用试卷图片",
      steps: [
        { title: "打开演示", description: "使用上方的试卷图片演示链接" },
        { title: "上传测试图片", description: "核对识别的题目和文字，识别结果可能有误" },
        { title: "核对答案", description: "试用现有输入和导出工具，答案不会发送到外部学习平台" },
      ],
    },
  },
});
