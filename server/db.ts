/**
 * Database Connection and Query Manager
 * Handles all database operations for the Basira platform
 */

// import { v4 as uuidv4 } from 'uuid';

// Generate UUID without external library
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const uuidv4 = generateUUID;
import type {
  User,
  Conversation,
  Message,
  QuestionsAnalytics,
  SupportTicket,
} from './schema';

// Mock database storage (in production, use real MySQL connection)
const mockDB = {
  users: new Map<string, User>(),
  conversations: new Map<string, Conversation>(),
  messages: new Map<string, Message>(),
  questionsAnalytics: new Map<string, QuestionsAnalytics>(),
  supportTickets: new Map<string, SupportTicket>(),
};

/**
 * Initialize database tables
 */
export async function initializeDatabase() {
  console.log('✅ Database initialized (mock mode)');
}

/**
 * User Operations
 */
export async function createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = uuidv4();
  const newUser: User = {
    id,
    ...user,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  mockDB.users.set(id, newUser);
  return newUser;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const users = Array.from(mockDB.users.values());
  for (const user of users) {
    if (user.email === email) return user;
  }
  return null;
}

export async function getUserById(id: string): Promise<User | null> {
  return mockDB.users.get(id) || null;
}

/**
 * Conversation Operations
 */
export async function createConversation(
  userId: string,
  title: string,
  language: 'ar' | 'en' = 'ar'
): Promise<Conversation> {
  const id = uuidv4();
  const conversation: Conversation = {
    id,
    userId,
    title,
    language,
    messageCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  mockDB.conversations.set(id, conversation);
  return conversation;
}

export async function getUserConversations(userId: string): Promise<Conversation[]> {
  const conversations: Conversation[] = [];
  const convs = Array.from(mockDB.conversations.values());
  for (const conv of convs) {
    if (conv.userId === userId) conversations.push(conv);
  }
  return conversations.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Message Operations
 */
export async function createMessage(
  conversationId: string,
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  language: 'ar' | 'en' = 'ar'
): Promise<Message> {
  const id = uuidv4();
  const message: Message = {
    id,
    conversationId,
    userId,
    role,
    content,
    language,
    createdAt: new Date(),
  };
  mockDB.messages.set(id, message);

  // Update conversation message count
  const conversation = mockDB.conversations.get(conversationId);
  if (conversation) {
    conversation.messageCount++;
    conversation.updatedAt = new Date();
  }

  return message;
}

export async function getConversationMessages(conversationId: string): Promise<Message[]> {
  const messages: Message[] = [];
  const msgs = Array.from(mockDB.messages.values());
  for (const msg of msgs) {
    if (msg.conversationId === conversationId) messages.push(msg);
  }
  return messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Questions Analytics Operations
 */
export async function recordQuestion(
  question: string,
  category: string,
  language: 'ar' | 'en' = 'ar'
): Promise<void> {
  const crypto = await import('crypto');
  const questionHash = crypto.createHash('sha256').update(question).digest('hex');

  const existing = Array.from(mockDB.questionsAnalytics.values()).find(
    (q) => q.questionHash === questionHash
  );

  if (existing) {
    existing.frequency++;
    existing.lastAskedAt = new Date();
  } else {
    const id = uuidv4();
    const newQuestion: QuestionsAnalytics = {
      id,
      questionHash,
      question,
      category,
      frequency: 1,
      language,
      lastAskedAt: new Date(),
      averageRating: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDB.questionsAnalytics.set(id, newQuestion);
  }
}

export async function getTopQuestions(limit: number = 10): Promise<QuestionsAnalytics[]> {
  const questions = Array.from(mockDB.questionsAnalytics.values());
  return questions.sort((a, b) => b.frequency - a.frequency).slice(0, limit);
}

export async function getQuestionsByCategory(category: string): Promise<QuestionsAnalytics[]> {
  const questions = Array.from(mockDB.questionsAnalytics.values()).filter(
    (q) => q.category === category
  );
  return questions.sort((a, b) => b.frequency - a.frequency);
}

/**
 * Support Ticket Operations
 */
export async function createSupportTicket(
  subject: string,
  description: string,
  email: string,
  userId?: string
): Promise<SupportTicket> {
  const id = uuidv4();
  const ticket: SupportTicket = {
    id,
    userId: userId || '',
    subject,
    description,
    status: 'open',
    priority: 'medium',
    email,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  mockDB.supportTickets.set(id, ticket);
  return ticket;
}

export async function getSupportTickets(status?: string): Promise<SupportTicket[]> {
  let tickets = Array.from(mockDB.supportTickets.values());
  if (status) {
    tickets = tickets.filter((t) => t.status === status);
  }
  return tickets.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Get Database Statistics
 */
export async function getDatabaseStats() {
  return {
    totalUsers: mockDB.users.size,
    totalConversations: mockDB.conversations.size,
    totalMessages: mockDB.messages.size,
    totalQuestions: mockDB.questionsAnalytics.size,
    totalTickets: mockDB.supportTickets.size,
  };
}

export default mockDB;
