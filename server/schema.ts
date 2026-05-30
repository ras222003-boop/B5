/**
 * Database Schema
 * Defines all tables and their structures for the Basira platform
 */

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'student' | 'teacher' | 'admin';
  language: 'ar' | 'en';
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  language: 'ar' | 'en';
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  language: 'ar' | 'en';
  rating?: number;
  feedback?: string;
  createdAt: Date;
}

export interface QuestionsAnalytics {
  id: string;
  questionHash: string;
  question: string;
  category: string;
  frequency: number;
  language: 'ar' | 'en';
  lastAskedAt: Date;
  averageRating: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserFeedback {
  id: string;
  userId: string;
  conversationId: string;
  messageId: string;
  rating: number;
  feedback: string;
  createdAt: Date;
}

export interface AssistantSettings {
  id: string;
  userId: string;
  autoSpeak: boolean;
  voiceSpeed: number;
  language: 'ar' | 'en';
  theme: 'light' | 'dark';
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeBase {
  id: string;
  category: string;
  question: string;
  answer: string;
  language: 'ar' | 'en';
  tags: string[];
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExamResult {
  id: string;
  userId: string;
  examId: string;
  score: number;
  totalQuestions: number;
  correctAnswers: number;
  timeSpent: number;
  language: 'ar' | 'en';
  createdAt: Date;
}

export interface ExamSession {
  id: string;
  userId: string;
  examId: string;
  startedAt: Date;
  endedAt?: Date;
  status: 'in_progress' | 'completed' | 'abandoned';
  currentQuestion: number;
  answers: Record<string, string>;
}

export interface NotificationLog {
  id: string;
  userId: string;
  type: 'question_frequency' | 'new_feature' | 'exam_result' | 'support_alert';
  title: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

export interface SupportTicket {
  id: string;
  userId: string;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

// SQL Table Creation Statements
export const SQL_SCHEMA = {
  users: `
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      role ENUM('student', 'teacher', 'admin') DEFAULT 'student',
      language ENUM('ar', 'en') DEFAULT 'ar',
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_email (email),
      INDEX idx_role (role)
    )
  `,
  
  conversations: `
    CREATE TABLE IF NOT EXISTS conversations (
      id VARCHAR(36) PRIMARY KEY,
      userId VARCHAR(36) NOT NULL,
      title VARCHAR(255),
      language ENUM('ar', 'en') DEFAULT 'ar',
      messageCount INT DEFAULT 0,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_userId (userId),
      INDEX idx_createdAt (createdAt)
    )
  `,
  
  messages: `
    CREATE TABLE IF NOT EXISTS messages (
      id VARCHAR(36) PRIMARY KEY,
      conversationId VARCHAR(36) NOT NULL,
      userId VARCHAR(36) NOT NULL,
      role ENUM('user', 'assistant') NOT NULL,
      content LONGTEXT NOT NULL,
      language ENUM('ar', 'en') DEFAULT 'ar',
      rating INT,
      feedback TEXT,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_conversationId (conversationId),
      INDEX idx_userId (userId),
      INDEX idx_role (role)
    )
  `,
  
  questions_analytics: `
    CREATE TABLE IF NOT EXISTS questions_analytics (
      id VARCHAR(36) PRIMARY KEY,
      questionHash VARCHAR(64) UNIQUE NOT NULL,
      question TEXT NOT NULL,
      category VARCHAR(100),
      frequency INT DEFAULT 1,
      language ENUM('ar', 'en') DEFAULT 'ar',
      lastAskedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      averageRating DECIMAL(3,2) DEFAULT 0,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_category (category),
      INDEX idx_frequency (frequency),
      INDEX idx_language (language)
    )
  `,
  
  user_feedback: `
    CREATE TABLE IF NOT EXISTS user_feedback (
      id VARCHAR(36) PRIMARY KEY,
      userId VARCHAR(36) NOT NULL,
      conversationId VARCHAR(36),
      messageId VARCHAR(36),
      rating INT NOT NULL,
      feedback TEXT,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (messageId) REFERENCES messages(id) ON DELETE CASCADE,
      INDEX idx_userId (userId),
      INDEX idx_rating (rating)
    )
  `,
  
  assistant_settings: `
    CREATE TABLE IF NOT EXISTS assistant_settings (
      id VARCHAR(36) PRIMARY KEY,
      userId VARCHAR(36) UNIQUE NOT NULL,
      autoSpeak BOOLEAN DEFAULT true,
      voiceSpeed DECIMAL(3,2) DEFAULT 1.0,
      language ENUM('ar', 'en') DEFAULT 'ar',
      theme ENUM('light', 'dark') DEFAULT 'light',
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_userId (userId)
    )
  `,
  
  knowledge_base: `
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id VARCHAR(36) PRIMARY KEY,
      category VARCHAR(100) NOT NULL,
      question TEXT NOT NULL,
      answer LONGTEXT NOT NULL,
      language ENUM('ar', 'en') DEFAULT 'ar',
      tags JSON,
      priority INT DEFAULT 0,
      isActive BOOLEAN DEFAULT true,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_category (category),
      INDEX idx_language (language),
      INDEX idx_isActive (isActive)
    )
  `,
  
  exam_results: `
    CREATE TABLE IF NOT EXISTS exam_results (
      id VARCHAR(36) PRIMARY KEY,
      userId VARCHAR(36) NOT NULL,
      examId VARCHAR(36) NOT NULL,
      score DECIMAL(5,2),
      totalQuestions INT,
      correctAnswers INT,
      timeSpent INT,
      language ENUM('ar', 'en') DEFAULT 'ar',
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_userId (userId),
      INDEX idx_examId (examId),
      INDEX idx_createdAt (createdAt)
    )
  `,
  
  exam_sessions: `
    CREATE TABLE IF NOT EXISTS exam_sessions (
      id VARCHAR(36) PRIMARY KEY,
      userId VARCHAR(36) NOT NULL,
      examId VARCHAR(36) NOT NULL,
      startedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      endedAt TIMESTAMP,
      status ENUM('in_progress', 'completed', 'abandoned') DEFAULT 'in_progress',
      currentQuestion INT DEFAULT 0,
      answers JSON,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_userId (userId),
      INDEX idx_status (status)
    )
  `,
  
  notification_logs: `
    CREATE TABLE IF NOT EXISTS notification_logs (
      id VARCHAR(36) PRIMARY KEY,
      userId VARCHAR(36) NOT NULL,
      type ENUM('question_frequency', 'new_feature', 'exam_result', 'support_alert') NOT NULL,
      title VARCHAR(255),
      message TEXT,
      isRead BOOLEAN DEFAULT false,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_userId (userId),
      INDEX idx_isRead (isRead),
      INDEX idx_createdAt (createdAt)
    )
  `,
  
  support_tickets: `
    CREATE TABLE IF NOT EXISTS support_tickets (
      id VARCHAR(36) PRIMARY KEY,
      userId VARCHAR(36),
      subject VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      status ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
      priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
      email VARCHAR(255) NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_status (status),
      INDEX idx_email (email),
      INDEX idx_createdAt (createdAt)
    )
  `
};
