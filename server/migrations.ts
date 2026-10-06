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
    const sharedMap = await readFile(resolve(process.cwd(), "server/migrations/0005_shared_map.sql"), "utf8");
    for (const statement of sharedMap.split(";").map(s => s.trim()).filter(Boolean)) {
      await connection.query(statement);
    }
    const organizations = await readFile(resolve(process.cwd(), "server/migrations/0006_organizations_production.sql"), "utf8");
    for (const statement of organizations.split(";").map(s => s.trim()).filter(Boolean)) {
      await connection.query(statement);
    }
    const examDelivery = await readFile(resolve(process.cwd(), "server/migrations/0007_exam_delivery.sql"), "utf8");
    for (const statement of examDelivery.split(";").map(s => s.trim()).filter(Boolean)) {
      await connection.query(statement);
    }
    const navigationZones = await readFile(resolve(process.cwd(), "server/migrations/0008_navigation_zones.sql"), "utf8");
    for (const statement of navigationZones.split(";").map(s => s.trim()).filter(Boolean)) {
      await connection.query(statement);
    }
    for (const [column, definition] of Object.entries({
      organization_id: 'varchar(36) NULL',
      official_map_source: 'varchar(30) NULL',
      official_approved_by: 'varchar(36) NULL',
      official_reviewed_at: 'timestamp(3) NULL',
    })) {
      const [existing] = await connection.query<any[]>("SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='basira_buildings' AND column_name=? LIMIT 1", [column]);
      if (!existing.length) await connection.query(`ALTER TABLE basira_buildings ADD COLUMN ${column} ${definition}`);
    }
    const [organizationIndex] = await connection.query<any[]>("SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='basira_buildings' AND index_name='building_organization_idx' LIMIT 1");
    if (!organizationIndex.length) await connection.query('CREATE INDEX building_organization_idx ON basira_buildings (organization_id)');
    for(const [name,column,target] of [['building_organization_fk','organization_id','basira_organizations'],['building_official_approver_fk','official_approved_by','`user`']]){
      const [existing]=await connection.query<any[]>('SELECT 1 FROM information_schema.table_constraints WHERE table_schema=DATABASE() AND table_name=? AND constraint_name=? LIMIT 1',['basira_buildings',name]);
      if(!existing.length)await connection.query(`ALTER TABLE basira_buildings ADD CONSTRAINT ${name} FOREIGN KEY (${column}) REFERENCES ${target}(id) ON DELETE SET NULL`);
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
    // Schema preparation is additive. Retention jobs must run separately from migrations.
  } finally {
    connection.release();
  }
}
