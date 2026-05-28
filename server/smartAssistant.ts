/**
 * Smart Assistant Logic
 * Handles AI responses, learning from questions, and analytics
 */

import crypto from "crypto";

interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

interface QuestionAnalytics {
  question: string;
  questionHash: string;
  frequency: number;
  category: string;
  language: "ar" | "en";
}

/**
 * Generate hash for question deduplication
 */
export function generateQuestionHash(question: string): string {
  return crypto.createHash("sha256").update(question.toLowerCase().trim()).digest("hex");
}

/**
 * Extract category from question using keywords
 */
export function categorizeQuestion(question: string, language: "ar" | "en"): string {
  const lowerQuestion = question.toLowerCase();

  if (language === "ar") {
    if (lowerQuestion.includes("كيف") || lowerQuestion.includes("طريقة") || lowerQuestion.includes("استخدام")) {
      return "كيفية الاستخدام";
    }
    if (lowerQuestion.includes("مشكلة") || lowerQuestion.includes("خطأ") || lowerQuestion.includes("مشاكل")) {
      return "مشاكل تقنية";
    }
    if (lowerQuestion.includes("ميزة") || lowerQuestion.includes("خاصية") || lowerQuestion.includes("يمكن")) {
      return "الميزات والإمكانيات";
    }
    if (lowerQuestion.includes("إعاقة") || lowerQuestion.includes("بصرية") || lowerQuestion.includes("كفيف")) {
      return "الإمكانية الوصول";
    }
    if (lowerQuestion.includes("اختبار") || lowerQuestion.includes("سؤال") || lowerQuestion.includes("إجابة")) {
      return "الاختبارات";
    }
    return "أخرى";
  } else {
    if (lowerQuestion.includes("how") || lowerQuestion.includes("way") || lowerQuestion.includes("use")) {
      return "How to Use";
    }
    if (lowerQuestion.includes("problem") || lowerQuestion.includes("error") || lowerQuestion.includes("issue")) {
      return "Technical Issues";
    }
    if (lowerQuestion.includes("feature") || lowerQuestion.includes("capability") || lowerQuestion.includes("can")) {
      return "Features";
    }
    if (lowerQuestion.includes("disability") || lowerQuestion.includes("visual") || lowerQuestion.includes("blind")) {
      return "Accessibility";
    }
    if (lowerQuestion.includes("exam") || lowerQuestion.includes("question") || lowerQuestion.includes("answer")) {
      return "Exams";
    }
    return "Other";
  }
}

/**
 * Build system prompt for AI Guide with learning capability
 */
export function buildSystemPrompt(
  language: "ar" | "en",
  frequentQuestions?: Array<{ question: string; answer: string; category: string }>
): string {
  if (language === "en") {
    let prompt = `You are an advanced AI guide for Basira platform, working like ChatGPT. Your role is to provide comprehensive, step-by-step guidance about the platform.

Your responsibilities:
1. Explain platform features in detail
2. Provide step-by-step instructions for using the platform
3. Answer technical questions
4. Give practical tips for exam success
5. Explain accessibility features
6. Help troubleshoot issues
7. Provide encouragement and support

Always:
- Use clear, simple language
- Break down complex topics into steps
- Provide examples when helpful
- Be friendly and supportive
- Use short sentences for better text-to-speech clarity
- Format responses with clear structure (headings, bullet points, numbered lists)
- Provide detailed, comprehensive answers

Be thorough and informative, like ChatGPT, providing complete guidance on any topic related to Basira.`;

    if (frequentQuestions && frequentQuestions.length > 0) {
      prompt += `\n\nFrequently Asked Questions (use these to improve responses):`;
      frequentQuestions.forEach((fq, idx) => {
        prompt += `\n${idx + 1}. Q: ${fq.question}\n   A: ${fq.answer}`;
      });
    }

    return prompt;
  } else {
    let prompt = `أنت مساعد ذكي متقدم لمنصة بصيرة، تعمل مثل ChatGPT. دورك تقديم إرشادات شاملة وخطوة بخطوة حول المنصة.

مسؤولياتك:
1. شرح مميزات المنصة بالتفصيل
2. تقديم تعليمات خطوة بخطوة لاستخدام المنصة
3. الإجابة على الأسئلة التقنية
4. تقديم نصائح عملية للنجاح في الاختبارات
5. شرح ميزات الإمكانية الوصول
6. مساعدة المستخدم في حل المشاكل
7. تقديم التشجيع والدعم

دائماً:
- استخدم لغة واضحة وبسيطة
- قسّم المواضيع المعقدة إلى خطوات
- قدّم أمثلة عند الحاجة
- كن ودوداً وداعماً
- استخدم جملاً قصيرة وواضحة لتحسين وضوح قراءة النصوص الصوتية
- نسّق الإجابات بشكل واضح (عناوين، نقاط، قوائم مرقمة)
- قدّم إجابات مفصلة وشاملة

كن شاملاً وغنياً بالمعلومات، مثل ChatGPT، مقدماً إرشادات كاملة حول أي موضوع يتعلق ببصيرة.`;

    if (frequentQuestions && frequentQuestions.length > 0) {
      prompt += `\n\nالأسئلة المتكررة (استخدمها لتحسين الإجابات):`;
      frequentQuestions.forEach((fq, idx) => {
        prompt += `\n${idx + 1}. س: ${fq.question}\n   ج: ${fq.answer}`;
      });
    }

    return prompt;
  }
}

/**
 * Analyze conversation for learning
 */
export function analyzeConversation(
  messages: AssistantMessage[],
  language: "ar" | "en"
): Array<{ question: string; category: string; hash: string }> {
  const questions: Array<{ question: string; category: string; hash: string }> = [];

  messages.forEach((msg) => {
    if (msg.role === "user") {
      const hash = generateQuestionHash(msg.content);
      const category = categorizeQuestion(msg.content, language);
      questions.push({
        question: msg.content,
        category,
        hash,
      });
    }
  });

  return questions;
}

/**
 * Generate response quality score based on feedback
 */
export function calculateResponseQuality(feedbackRatings: number[]): number {
  if (feedbackRatings.length === 0) return 0;
  const average = feedbackRatings.reduce((a, b) => a + b, 0) / feedbackRatings.length;
  return Math.round((average / 5) * 100); // Convert to 0-100 scale
}

/**
 * Get suggested topics based on frequent questions
 */
export function getSuggestedTopics(
  frequentQuestions: QuestionAnalytics[],
  language: "ar" | "en"
): Array<{ label: string; action: string; category: string }> {
  const topics = frequentQuestions
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 4)
    .map((q) => ({
      label: q.question.substring(0, 50) + (q.question.length > 50 ? "..." : ""),
      action: q.question,
      category: q.category,
    }));

  // Add default topics if not enough frequent questions
  if (topics.length < 4) {
    const defaultTopics =
      language === "ar"
        ? [
            { label: "كيف أبدأ الاختبار؟", action: "شرح لي خطوات البدء بالاختبار بالتفصيل", category: "كيفية الاستخدام" },
            { label: "شرح المميزات", action: "اشرح لي جميع مميزات منصة بصيرة بشكل مفصل", category: "الميزات" },
            { label: "نصائح للنجاح", action: "أعطني نصائح عملية لتحقيق أفضل أداء في الاختبارات", category: "نصائح" },
            { label: "مساعدة تقنية", action: "ساعدني في حل المشاكل التقنية والأخطاء", category: "مشاكل تقنية" },
          ]
        : [
            { label: "How to start exam?", action: "Explain the steps to start an exam in detail", category: "How to Use" },
            { label: "Explain features", action: "Explain all features of Basira platform in detail", category: "Features" },
            { label: "Success tips", action: "Give me practical tips to achieve the best performance in exams", category: "Tips" },
            { label: "Technical help", action: "Help me solve technical issues and errors", category: "Technical Issues" },
          ];

    return [...topics, ...defaultTopics.slice(0, 4 - topics.length)];
  }

  return topics;
}

/**
 * Detect if a question is similar to previous ones
 */
export function findSimilarQuestions(
  currentQuestion: string,
  previousQuestions: Array<{ question: string; hash: string }>,
  threshold: number = 0.8
): Array<{ question: string; similarity: number }> {
  const currentHash = generateQuestionHash(currentQuestion);
  const similar: Array<{ question: string; similarity: number }> = [];

  previousQuestions.forEach((prev) => {
    // Simple similarity check using hash and string similarity
    const similarity = calculateStringSimilarity(currentQuestion, prev.question);
    if (similarity >= threshold) {
      similar.push({
        question: prev.question,
        similarity,
      });
    }
  });

  return similar.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Calculate string similarity (Levenshtein distance)
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1;

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1;

  const editDistance = getEditDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein distance
 */
function getEditDistance(s1: string, s2: string): number {
  const costs: number[] = [];

  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }

  return costs[s2.length];
}
