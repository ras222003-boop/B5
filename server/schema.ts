import { mysqlTable, varchar, text, timestamp, int, boolean, json, enum as mysqlEnum, bigint } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

// Users table
export const users = mysqlTable("users", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  email: varchar("email", { length: 255 }).unique().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["admin", "teacher", "student"]).default("student"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// Conversations table - لتخزين المحادثات
export const conversations = mysqlTable("conversations", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  title: varchar("title", { length: 255 }).default("محادثة جديدة"),
  language: mysqlEnum("language", ["ar", "en"]).default("ar"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// Messages table - لتخزين الرسائل في كل محادثة
export const messages = mysqlTable("messages", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  conversationId: bigint("conversation_id", { mode: "number" }).notNull(),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Questions Analytics table - لتحليل الأسئلة المتكررة
export const questionsAnalytics = mysqlTable("questions_analytics", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  question: text("question").notNull(),
  questionHash: varchar("question_hash", { length: 64 }).unique(), // للمقارنة السريعة
  language: mysqlEnum("language", ["ar", "en"]).default("ar"),
  frequency: int("frequency").default(1), // عدد مرات السؤال
  category: varchar("category", { length: 100 }), // تصنيف السؤال (مثل: "كيفية الاستخدام", "مشاكل تقنية", إلخ)
  bestAnswer: text("best_answer"), // أفضل إجابة
  answerQuality: int("answer_quality").default(0), // تقييم جودة الإجابة (0-100)
  lastAskedAt: timestamp("last_asked_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// User Feedback table - لتقييم إجابات المساعد
export const userFeedback = mysqlTable("user_feedback", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  messageId: bigint("message_id", { mode: "number" }).notNull(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  rating: int("rating").notNull(), // 1-5
  feedback: text("feedback"), // تعليق المستخدم
  helpful: boolean("helpful"), // هل كانت الإجابة مفيدة؟
  createdAt: timestamp("created_at").defaultNow(),
});

// Assistant Settings table - إعدادات المساعد
export const assistantSettings = mysqlTable("assistant_settings", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  language: mysqlEnum("language", ["ar", "en"]).default("ar"),
  autoSpeak: boolean("auto_speak").default(true),
  voiceSpeed: int("voice_speed").default(0.9), // 0.5-2.0
  theme: mysqlEnum("theme", ["light", "dark"]).default("light"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// Knowledge Base table - قاعدة معرفية للإجابات المسبقة
export const knowledgeBase = mysqlTable("knowledge_base", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  category: varchar("category", { length: 100 }).notNull(), // مثل: "كيفية الاستخدام", "الميزات", إلخ
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  language: mysqlEnum("language", ["ar", "en"]).default("ar"),
  tags: json("tags").$type<string[]>(), // تصنيفات إضافية
  priority: int("priority").default(0), // أولوية الإجابة
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// Relations (simplified without relations for now)
// These can be enabled when full Drizzle ORM setup is complete
