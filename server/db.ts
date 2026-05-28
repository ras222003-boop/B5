import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

let db: ReturnType<typeof drizzle>;

async function initializeDb() {
  if (!db) {
    const connection = await mysql.createConnection(DATABASE_URL);
    db = drizzle(connection, { schema, mode: "default" });
  }
  return db;
}

export async function getDb() {
  return initializeDb();
}

export { schema };
