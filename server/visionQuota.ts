import { createHash, randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';

export type VisionLimits = {
  userPerMinute: number;
  userPerDay: number;
  globalPerMinute: number;
  globalPerDay: number;
  concurrent: number;
};
export type VisionQuotaStore = { reserve(userId: string, limits: VisionLimits): Promise<() => Promise<void>> };
export class VisionQuotaError extends Error {
  constructor(readonly code: 'access_denied' | 'rate_limited') { super(code); }
}

const bounded = (name: string, fallback: number, maximum: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
};
export function visionLimits(): VisionLimits {
  return {
    userPerMinute: bounded('BASIRA_VISION_USER_PER_MINUTE', 3, 20),
    userPerDay: bounded('BASIRA_VISION_USER_PER_DAY', 20, 200),
    globalPerMinute: bounded('BASIRA_VISION_GLOBAL_PER_MINUTE', 10, 60),
    globalPerDay: bounded('BASIRA_VISION_GLOBAL_PER_DAY', 500, 5000),
    concurrent: bounded('BASIRA_VISION_MAX_CONCURRENT', 2, 10),
  };
}

type CountRow = RowDataPacket & { requests: number };
type GrantRow = RowDataPacket & { enabled: number; minute_limit: number | null; daily_limit: number | null };
type ClockRow = RowDataPacket & { now_ms: number };
type ActiveRow = RowDataPacket & { count: number };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const globalKey = '0'.repeat(64);

/** The single locked row makes quota checks and lease creation atomic across app instances. */
export class MysqlVisionQuotaStore implements VisionQuotaStore {
  constructor(private readonly getPool: () => Promise<Pool> = async () => (await import('./auth')).pool) {}

  async reserve(userId: string, limits: VisionLimits): Promise<() => Promise<void>> {
    const pool = await this.getPool();
    const connection = await pool.getConnection();
    const leaseId = randomUUID();
    try {
      await connection.beginTransaction();
      const [mutex] = await connection.execute<RowDataPacket[]>('SELECT id FROM basira_vision_quota_mutex WHERE id=1 FOR UPDATE');
      if (!mutex.length) throw new Error('vision_quota_schema_missing');
      const [clock] = await connection.execute<ClockRow[]>('SELECT UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS now_ms');
      const now = Number(clock[0].now_ms);
      const [grants] = await connection.execute<GrantRow[]>('SELECT enabled,minute_limit,daily_limit FROM basira_vision_entitlements WHERE user_id=? LIMIT 1', [userId]);
      const grant = grants[0];
      if (grant && Number(grant.enabled) === 0) throw new VisionQuotaError('access_denied');
      const minuteLimit = grant?.minute_limit == null ? limits.userPerMinute : Math.min(Math.max(1, Number(grant.minute_limit)), 20);
      const dayLimit = grant?.daily_limit == null ? limits.userPerDay : Math.min(Math.max(1, Number(grant.daily_limit)), 200);
      await connection.execute('DELETE FROM basira_vision_leases WHERE expires_at<=CURRENT_TIMESTAMP(3)');
      const [active] = await connection.execute<ActiveRow[]>('SELECT COUNT(*) AS count FROM basira_vision_leases');
      if (Number(active[0].count) >= limits.concurrent) throw new VisionQuotaError('rate_limited');
      const minute = Math.floor(now / 60_000) * 60_000;
      const day = Math.floor(now / 86_400_000) * 86_400_000;
      await connection.execute('DELETE FROM basira_vision_quota WHERE window_start<?', [day - 2 * 86_400_000]);
      const buckets = [
        ['user_minute', digest(userId), minute, minuteLimit],
        ['user_day', digest(userId), day, dayLimit],
        ['global_minute', globalKey, minute, limits.globalPerMinute],
        ['global_day', globalKey, day, limits.globalPerDay],
      ] as const;
      for (const [scope, subject, start, maximum] of buckets) {
        const [rows] = await connection.execute<CountRow[]>('SELECT requests FROM basira_vision_quota WHERE scope=? AND subject_key=? AND window_start=?', [scope, subject, start]);
        if (Number(rows[0]?.requests ?? 0) >= maximum) throw new VisionQuotaError('rate_limited');
      }
      for (const [scope, subject, start] of buckets) {
        await connection.execute('INSERT INTO basira_vision_quota (scope,subject_key,window_start,requests) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE requests=requests+1', [scope, subject, start]);
      }
      await connection.execute('INSERT INTO basira_vision_leases (id,expires_at) VALUES (?,DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 120 SECOND))', [leaseId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return async () => {
      try { await pool.execute('DELETE FROM basira_vision_leases WHERE id=?', [leaseId]); }
      catch { /* The 120-second database lease also bounds a failed release. */ }
    };
  }
}
