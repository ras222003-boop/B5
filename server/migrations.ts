import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "./auth";

/** Additive startup preparation: preserves rows on restart and across deployments. */
export async function ensureSchema() {
  const file = await readFile(resolve(process.cwd(), "server/migrations/0001_auth.sql"), "utf8");
  const statements = file.split(";").map(s => s.trim()).filter(Boolean);
  const connection = await pool.getConnection();
  try {
    for (const statement of statements) {
      const table = statement.match(/^create table `([\w]+)`/i)?.[1];
      if (table) {
        const [rows] = await connection.query<any[]>(
          "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1", [table],
        );
        if (rows.length) continue;
      }
      const index = statement.match(/^create index `([\w]+)` on `([\w]+)`/i);
      if (index) {
        const [rows] = await connection.query<any[]>(
          "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1", [index[2], index[1]],
        );
        if (rows.length) continue;
      }
      await connection.query(statement);
    }
    const support = await readFile(resolve(process.cwd(), "server/migrations/0002_support.sql"), "utf8");
    await connection.query(support);
    const navigation = await readFile(resolve(process.cwd(), "server/migrations/0003_navigation.sql"), "utf8");
    for (const statement of navigation.split(";").map(s => s.trim()).filter(Boolean)) {
      await connection.query(statement);
    }
    const localization = await readFile(resolve(process.cwd(), "server/migrations/0004_localization.sql"), "utf8");
    for (const statement of localization.split(";").map(s => s.trim()).filter(Boolean)) {
      await connection.query(statement);
    }
    for (const [column,definition] of Object.entries({local_x:'decimal(12,3) NULL',local_y:'decimal(12,3) NULL',localization_confidence:'decimal(4,3) NULL'})) {
      const [existing] = await connection.query<any[]>("SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='basira_saved_places' AND column_name=? LIMIT 1",[column]);
      if (!existing.length) await connection.query(`ALTER TABLE basira_saved_places ADD COLUMN ${column} ${definition}`);
    }
    const [attemptsColumn] = await connection.query<any[]>(
      "SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='basira_support_tickets' AND column_name='delivery_attempts' LIMIT 1",
    );
    if (!attemptsColumn.length) await connection.query("ALTER TABLE basira_support_tickets ADD COLUMN delivery_attempts int unsigned NOT NULL DEFAULT 0");
    const [keyColumn] = await connection.query<any[]>(
      "SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='basira_support_tickets' AND column_name='request_key' LIMIT 1",
    );
    if (!keyColumn.length) await connection.query("ALTER TABLE basira_support_tickets ADD COLUMN request_key char(64) DEFAULT NULL");
    const [keyIndex] = await connection.query<any[]>(
      "SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='basira_support_tickets' AND index_name='support_request_key_idx' LIMIT 1",
    );
    if (!keyIndex.length) await connection.query("CREATE UNIQUE INDEX support_request_key_idx ON basira_support_tickets (request_key)");
  } finally {
    connection.release();
  }
}
