import { defineMessages } from "../define";

/** Strings for the customer support chat and ticket flow. */
export const supportMessages = defineMessages({
  ar: {
    meta: { title: "الدعم الفني | بصيرة · Aurum Nexus" },
    hero: {
      badge: "دعم العملاء · Aurum Nexus",
      title: "دعم فني يفهم مشكلتك، ويتابعها",
      description:
        "ابدأ بمحادثة المساعد الذكي للحصول على خطوات حل عملية. إذا لم تنجح، افتح تذكرة متابعة برقم مرجعي.",
    },
    chat: {
      title: "مساعد الدعم الذكي",
      subtitle: "قدّم وصف المشكلة، ولا تشارك كلمة مرورك",
      logLabel: "سجل المحادثة",
      greeting:
        "مرحبًا! أخبرني ما المشكلة التي واجهتك في بصيرة. سأقترح خطوات واضحة، وإذا لم تُحل يمكنك فتح تذكرة متابعة.",
      thinking: "يفكر المساعد في خطوات مناسبة...",
      inputLabel: "رسالتك إلى مساعد الدعم",
      inputPlaceholder: "صف المشكلة التي واجهتك...",
      sendMessage: "إرسال رسالة إلى المساعد",
      fallbackReply:
        "لم أتمكن من الرد الآن. يمكنك فتح تذكرة ليتم متابعة مشكلتك.",
    },
    contact: {
      title: "ما زالت المشكلة قائمة؟",
      description:
        "يمكنك فتح تذكرة حتى إن تعذّرت الدردشة. سنحفظ وصف المشكلة لتتم متابعتها.",
      openTicket: "افتح تذكرة دعم",
      emailTitle: "بريد الدعم",
      emailDescription: "بإمكانك التواصل مباشرة إذا تعذّر استخدام صفحة الدعم.",
      accountLink: "سجّل دخولك لمتابعة تذاكرك",
    },
    ticket: {
      title: "تذكرة دعم جديدة",
      description:
        "أدخل بيانات التواصل ووصفًا واضحًا. إرسال المحادثة اختياري وبموافقتك فقط.",
      nameLabel: "الاسم",
      emailLabel: "البريد الإلكتروني",
      subjectLabel: "موضوع المشكلة",
      descriptionLabel: "وصف المشكلة",
      descriptionPlaceholder: "ماذا حدث؟ وما الخطوات التي جرّبتها؟",
      transcriptConsent: "أوافق على إرفاق مقتطف من محادثة الدعم مع التذكرة",
      save: "حفظ التذكرة وإرسال إشعار إن توفر",
      saving: "جارٍ الحفظ...",
      saved: (id: string) => `حُفظت تذكرتك برقم ${id}`,
    },
    delivery: {
      sent: (email: string) =>
        `قَبِل خادم البريد إرسال إشعار التذكرة إلى ${email}.`,
      failed:
        "حُفظت التذكرة لكن تعذّر إرسال إشعار البريد حاليًا. يمكنك التواصل بالبريد مباشرة.",
      pending:
        "حُفظت التذكرة، لكن إرسال البريد لم يُفعّل بعد. يمكنك التواصل بالبريد مباشرة.",
      uncertain:
        "حُفظت التذكرة، لكن لم نتمكن من تأكيد إرسال إشعار البريد. يمكنك التواصل بالبريد مباشرة.",
    },
    transcript: { user: "المستخدم", assistant: "المساعد" },
    errors: {
      chatUnavailable:
        "تعذر الحصول على رد من المساعد. حاول مرة أخرى أو افتح تذكرة دعم.",
      ticketUnavailable: "تعذر حفظ التذكرة. تحقق من اتصالك وحاول مرة أخرى.",
    },
  },
  en: {
    meta: { title: "Support | Basira · Aurum Nexus" },
    hero: {
      badge: "Customer support · Aurum Nexus",
      title: "Technical support that understands and follows up",
      description:
        "Start with the AI support assistant for practical troubleshooting steps. If they do not help, open a follow-up ticket with a reference number.",
    },
    chat: {
      title: "AI Support Assistant",
      subtitle: "Describe the issue, and never share your password",
      logLabel: "Conversation history",
      greeting:
        "Hello! Tell me what issue you encountered in Basira. I will suggest clear steps, and you can open a follow-up ticket if it is not resolved.",
      thinking: "The assistant is considering appropriate steps...",
      inputLabel: "Your message to the support assistant",
      inputPlaceholder: "Describe the issue you encountered...",
      sendMessage: "Send message to the assistant",
      fallbackReply:
        "I could not respond right now. You can open a ticket so your issue can be followed up.",
    },
    contact: {
      title: "Is the issue still happening?",
      description:
        "You can open a ticket even if chat is unavailable. We will save your issue description for follow-up.",
      openTicket: "Open a support ticket",
      emailTitle: "Support email",
      emailDescription:
        "You can contact us directly if you cannot use the support page.",
      accountLink: "Sign in to track your tickets",
    },
    ticket: {
      title: "New support ticket",
      description:
        "Enter your contact details and a clear description. Sending the conversation is optional and requires your consent.",
      nameLabel: "Name",
      emailLabel: "Email address",
      subjectLabel: "Issue subject",
      descriptionLabel: "Issue description",
      descriptionPlaceholder: "What happened, and what steps have you tried?",
      transcriptConsent:
        "I agree to attach an excerpt of the support conversation to this ticket",
      save: "Save ticket and send a notification if available",
      saving: "Saving...",
      saved: (id: string) => `Your ticket ${id} has been saved`,
    },
    delivery: {
      sent: (email: string) =>
        `The email server accepted the ticket notification for delivery to ${email}.`,
      failed:
        "The ticket was saved, but the email notification could not be sent right now. You can contact us directly by email.",
      pending:
        "The ticket was saved, but email delivery has not been enabled yet. You can contact us directly by email.",
      uncertain:
        "The ticket was saved, but we could not confirm the email notification. You can contact us directly by email.",
    },
    transcript: { user: "User", assistant: "Assistant" },
    errors: {
      chatUnavailable:
        "We could not get a response from the assistant. Try again or open a support ticket.",
      ticketUnavailable:
        "We could not save the ticket. Check your connection and try again.",
    },
  },
  "zh-CN": {
    meta: { title: "技术支持 | Basira · Aurum Nexus" },
    hero: {
      badge: "客户支持 · Aurum Nexus",
      title: "理解问题并持续跟进的技术支持",
      description:
        "先通过 AI 支持助手获取实用的排查步骤；如果问题仍未解决，请创建一张带参考编号的跟进工单。",
    },
    chat: {
      title: "AI 支持助手",
      subtitle: "请描述问题，切勿分享密码",
      logLabel: "对话记录",
      greeting:
        "你好！请告诉我你在 Basira 中遇到的问题。我会提供清晰的解决步骤；如果问题仍未解决，你可以创建跟进工单。",
      thinking: "助手正在思考合适的解决步骤...",
      inputLabel: "发送给支持助手的消息",
      inputPlaceholder: "请描述你遇到的问题...",
      sendMessage: "向助手发送消息",
      fallbackReply: "我暂时无法回复。你可以创建工单，以便我们跟进你的问题。",
    },
    contact: {
      title: "问题仍然存在吗？",
      description:
        "即使无法使用对话功能，你也可以创建工单。我们会保存问题描述以便跟进。",
      openTicket: "创建支持工单",
      emailTitle: "支持邮箱",
      emailDescription: "如果无法使用支持页面，你可以直接联系我们。",
      accountLink: "登录以跟踪你的工单",
    },
    ticket: {
      title: "新建支持工单",
      description:
        "填写联系方式和清晰的问题说明。发送对话内容为可选操作，且仅在你同意后进行。",
      nameLabel: "姓名",
      emailLabel: "电子邮箱",
      subjectLabel: "问题主题",
      descriptionLabel: "问题描述",
      descriptionPlaceholder: "发生了什么？你尝试过哪些步骤？",
      transcriptConsent: "我同意将支持对话的摘录附加到此工单",
      save: "保存工单，并在可用时发送通知",
      saving: "正在保存...",
      saved: (id: string) => `你的工单 ${id} 已保存`,
    },
    delivery: {
      sent: (email: string) => `邮件服务器已接受向 ${email} 发送工单通知。`,
      failed:
        "工单已保存，但目前无法发送邮件通知。你可以直接通过电子邮件联系我们。",
      pending:
        "工单已保存，但尚未启用邮件发送。你可以直接通过电子邮件联系我们。",
      uncertain:
        "工单已保存，但无法确认邮件通知是否已发送。你可以直接通过电子邮件联系我们。",
    },
    transcript: { user: "用户", assistant: "助手" },
    errors: {
      chatUnavailable: "无法获取助手回复。请重试或创建支持工单。",
      ticketUnavailable: "无法保存工单。请检查网络连接后重试。",
    },
  },
});
