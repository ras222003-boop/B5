import type { PoolOptions } from "mysql2/promise";

/** Keep private-network staging credentials out of URLs and repository files. */
export function databaseConnectionOptions(env: NodeJS.ProcessEnv): PoolOptions {
  const host = env.BASIRA_DB_HOST;
  const password = env.BASIRA_DB_PASSWORD;
  const usingSeparateFields = [host, password, env.BASIRA_DB_USER, env.BASIRA_DB_NAME]
    .some(value => value !== undefined);
  if (env.DATABASE_URL && usingSeparateFields) {
    throw new Error("Configure DATABASE_URL or BASIRA_DB_* fields, not both");
  }
  if (env.DATABASE_URL) {
    return { uri: env.DATABASE_URL, waitForConnections: true, connectionLimit: 6 };
  }
  if (!host || !password || !env.BASIRA_DB_USER || !env.BASIRA_DB_NAME) {
    throw new Error("DATABASE_URL or complete BASIRA_DB_* settings are required for Basira accounts");
  }
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(host) || host.includes("..") ||
      !/^[a-z0-9_]+$/i.test(env.BASIRA_DB_USER) ||
      !/^[a-z0-9_]+$/i.test(env.BASIRA_DB_NAME)) {
    throw new Error("Invalid BASIRA_DB_* connection settings");
  }
  return {
    host,
    port: 3306,
    user: env.BASIRA_DB_USER,
    password,
    database: env.BASIRA_DB_NAME,
    waitForConnections: true,
    connectionLimit: 6,
  };
}
