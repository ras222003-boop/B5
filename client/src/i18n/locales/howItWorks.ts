import { defineMessages } from "../define";

export const howItWorksMessages = defineMessages({
  ar: {
    hero: {
      badge: "آلية العمل",
      title: "كيف تعمل منصة بصيرة؟",
      description: "خمس خطوات بسيطة تُمكّن الطالب الكفيف من أداء اختباره بشكل مستقل بالكامل.",
    },
    steps: [
      {
        number: "01",
        title: "تصوير ورقة الاختبار",
        description: "يفتح المستخدم التطبيق ويوجّه كاميرا الجوال نحو ورقة الاختبار. تقوم تقنية OCR المتقدمة بالتعرف على جميع الأسئلة والنصوص الموجودة في الورقة.",
      },
      {
        number: "02",
        title: "قراءة الأسئلة بالصوت",
        description: "يتم تحويل الأسئلة المكتشفة إلى صوت عربي واضح وطبيعي يُقرأ للمستخدم. يمكن التحكم بسرعة القراءة والتنقل بين الأسئلة بالأوامر الصوتية أو اللمسية.",
      },
      {
        number: "03",
        title: "تدوين الإجابات",
        description: "يجيب المستخدم بإحدى الطرق: الإدخال الصوتي (تحويل الكلام إلى نص)، أو الكتابة المباشرة داخل التطبيق بطريقة سهلة مشابهة لتطبيقات المحادثة.",
      },
      {
        number: "04",
        title: "تجميع الإجابات",
        description: "بعد الانتهاء، تقوم المنصة بتجميع جميع الإجابات تلقائياً داخل نموذج منظم مطابق لورقة الاختبار الأصلية.",
      },
      {
        number: "05",
        title: "حفظ وتصدير PDF",
        description: "يتم حفظ الاختبار النهائي بصيغة PDF جاهزة للطباعة أو الإرسال للمعلم. يستطيع المعلم طباعة الملف مباشرة وكأن الطالب كتب الاختبار بنفسه.",
      },
    ],
    stepLabel: "الخطوة",
    cameraShowcase: {
      title: "مسح الاختبار بالكاميرا",
      description: "ما عليك سوى توجيه كاميرا جوالك نحو ورقة الاختبار. تقوم تقنية التعرف الضوئي على الحروف (OCR) بقراءة جميع الأسئلة وتحويلها إلى نص رقمي بدقة عالية.",
      bullets: ["دعم اللغة العربية بالكامل", "تعرف على الخطوط المطبوعة واليدوية", "معالجة فورية وسريعة"],
      imageAlt: "مسح ورقة الاختبار بالكاميرا وتحويلها إلى نص رقمي",
    },
    pdfShowcase: {
      title: "تصدير PDF احترافي",
      description: "بعد الانتهاء من الاختبار، تقوم المنصة بتجميع جميع الإجابات في ملف PDF منظم ومطابق لنموذج الاختبار الأصلي، جاهز للطباعة أو الإرسال مباشرة.",
      bullets: ["نموذج مطابق لورقة الاختبار", "جاهز للطباعة المباشرة", "إمكانية الإرسال للمعلم إلكترونياً"],
      imageAlt: "تصدير الاختبار كملف PDF جاهز للطباعة",
    },
  },
  en: {
    hero: {
      badge: "How it works",
      title: "How does Basira work?",
      description: "Five simple steps that enable a blind student to complete an exam fully independently.",
    },
    steps: [
      {
        number: "01",
        title: "Photograph the exam paper",
        description: "The user opens the app and points the phone camera at the exam paper. Advanced OCR recognizes all the questions and text on the page.",
      },
      {
        number: "02",
        title: "Listen to the questions",
        description: "Detected questions are converted into clear, natural speech and read aloud. The user can control reading speed and move between questions with voice or touch commands.",
      },
      {
        number: "03",
        title: "Record the answers",
        description: "The user answers in either of two ways: voice input, which converts speech to text, or direct typing in the app through an easy interface similar to messaging apps.",
      },
      {
        number: "04",
        title: "Compile the answers",
        description: "When finished, the platform automatically gathers all answers into an organized form that matches the original exam paper.",
      },
      {
        number: "05",
        title: "Save and export as PDF",
        description: "The completed exam is saved as a print-ready PDF that can be sent to the teacher. The teacher can print it directly as if the student had written the exam by hand.",
      },
    ],
    stepLabel: "Step",
    cameraShowcase: {
      title: "Scan the exam with the camera",
      description: "Simply point your phone camera at the exam paper. Optical character recognition (OCR) reads every question and accurately converts it into digital text.",
      bullets: ["Full Arabic language support", "Recognition of printed and handwritten text", "Fast, immediate processing"],
      imageAlt: "Scanning an exam paper with the camera and converting it to digital text",
    },
    pdfShowcase: {
      title: "Professional PDF export",
      description: "After the exam is complete, the platform gathers all answers into an organized PDF that matches the original exam format, ready to print or send immediately.",
      bullets: ["Format matching the exam paper", "Ready for direct printing", "Option to send electronically to the teacher"],
      imageAlt: "Exporting the exam as a print-ready PDF",
    },
  },
  "zh-CN": {
    hero: {
      badge: "工作原理",
      title: "Basira 如何运作？",
      description: "只需五个简单步骤，视障学生即可完全独立地完成考试。",
    },
    steps: [
      {
        number: "01",
        title: "拍摄试卷",
        description: "用户打开应用，将手机摄像头对准试卷。先进的 OCR 技术会识别试卷上的所有题目和文字。",
      },
      {
        number: "02",
        title: "朗读试题",
        description: "识别出的题目会转换为清晰、自然的语音并朗读出来。用户可以控制朗读速度，并通过语音或触控指令切换题目。",
      },
      {
        number: "03",
        title: "记录答案",
        description: "用户可以选择语音输入（将语音转换为文字），也可以直接在应用中输入；操作方式简单，类似聊天应用。",
      },
      {
        number: "04",
        title: "整理答案",
        description: "完成答题后，平台会自动将所有答案整理到与原试卷相匹配的规范表单中。",
      },
      {
        number: "05",
        title: "保存并导出 PDF",
        description: "完成的试卷会保存为可打印的 PDF，也可以发送给教师。教师可以直接打印，就像学生亲自手写完成了一样。",
      },
    ],
    stepLabel: "步骤",
    cameraShowcase: {
      title: "用摄像头扫描试卷",
      description: "只需将手机摄像头对准试卷。光学字符识别（OCR）技术会读取所有题目，并将其准确转换为数字文本。",
      bullets: ["完整支持阿拉伯语", "识别印刷体和手写文字", "快速即时处理"],
      imageAlt: "用摄像头扫描试卷并将其转换为数字文本",
    },
    pdfShowcase: {
      title: "专业 PDF 导出",
      description: "考试完成后，平台会将所有答案整理到与原试卷格式一致的 PDF 文件中，可直接打印或发送。",
      bullets: ["与试卷格式一致", "可直接打印", "可电子发送给教师"],
      imageAlt: "将考试导出为可打印的 PDF 文件",
    },
  },
});
