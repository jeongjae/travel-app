// SQLite Durable Object 저장소. 표 정의와 읽기·쓰기만 둔다. 판단은 jobs.ts·auth.ts가 한다.
import { toStoredJob, type AiV2Job } from '../../src/ai-v2-jobs-core.ts';

/** DO `ctx.storage.sql`과 시험용 node:sqlite 어댑터가 함께 맞추는 최소 형태. */
export type SqlValue = string | number | null | ArrayBuffer;
export interface SqlLike {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, SqlValue>[] };
}
/** 여러 쓰기를 하나로 확정한다. DO는 `ctx.storage.transactionSync`, 시험은 BEGIN/COMMIT을 쓴다. */
export type SqlTransaction = <T>(body: () => T) => T;

export type StoredJobRow = { job: AiV2Job; fingerprint: string; responseId: string | null };
/** 실행 중 작업의 요청 원문·조사 본문(U-D2-1). 작업이 끝나는 쓰기와 같은 트랜잭션에서 지운다. */
export type InflightRow = { input: string; research: string | null; repair: string };
export type CredentialRow = { id: string; publicKey: string; counter: number; transports: string[] };
/** 화면에 보여도 되는 자격 정보. 공개키·카운터·자격 ID 원문은 내보내지 않는다. */
export type CredentialSummary = { ref: string; label: string; createdAt: string; lastUsedAt: string | null };

const schema = [
  // data는 toStoredJob 허용 목록을 거친 JSON만 담는다. 요청 원문·고른 기록·활동 제목은 들어오지 않는다.
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    status TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    response_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    data TEXT NOT NULL
  )`,
  // 실행 중에만 있는 행. 응답·백업·내보내기로 나가지 않고, 작업이 끝나는 즉시 지운다(결정 11/10 U-D2-1).
  `CREATE TABLE IF NOT EXISTS inflight (
    job_id TEXT PRIMARY KEY,
    input TEXT NOT NULL,
    research TEXT,
    repair TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL,
    transports TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS daily_counts (
    day TEXT PRIMARY KEY,
    jobs INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS challenges (
    challenge TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

/** 기존 표에 열을 더한다. 이미 있으면(재시작) SQLite가 duplicate column으로 거절하므로 무시한다. */
const columnMigrations = [
  `ALTER TABLE credentials ADD COLUMN label TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE credentials ADD COLUMN last_used_at TEXT`,
];

const text = (value: SqlValue | undefined) => (typeof value === 'string' ? value : '');
const count = (value: SqlValue | undefined) => (typeof value === 'number' ? value : 0);

export class AiStore {
  private sql: SqlLike;
  private transaction: SqlTransaction;
  constructor(sql: SqlLike, transaction: SqlTransaction = (body) => body()) {
    this.sql = sql;
    this.transaction = transaction;
    for (const statement of schema) {
      this.sql.exec(statement);
    }
    for (const statement of columnMigrations) {
      try {
        this.sql.exec(statement);
      } catch (error) {
        if (!/duplicate column/i.test(error instanceof Error ? error.message : String(error))) {
          throw error;
        }
      }
    }
  }

  /** 안의 쓰기가 모두 확정되거나 모두 취소된다. 안에서 await하지 않는다. */
  atomic<T>(body: () => T): T {
    return this.transaction(body);
  }

  // ── 작업 ──
  getJob(id: string): StoredJobRow | undefined {
    const row = this.sql.exec('SELECT data, fingerprint, response_id FROM jobs WHERE id = ?', id).toArray()[0];
    return row ? this.toRow(row) : undefined;
  }
  listJobs(statuses?: readonly string[]): StoredJobRow[] {
    const rows = statuses
      ? this.sql
          .exec(
            `SELECT data, fingerprint, response_id FROM jobs WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at`,
            ...statuses,
          )
          .toArray()
      : this.sql.exec('SELECT data, fingerprint, response_id FROM jobs ORDER BY created_at').toArray();
    return rows.map((row) => this.toRow(row));
  }
  /** 보존 기한이 지난 끝난 작업만. 매 조회마다 부르므로 전 행을 읽지 않고 SQL에서 거른다. */
  listExpirable(keepStatuses: readonly string[], cutoffIso: string): StoredJobRow[] {
    const skip = [...keepStatuses, 'expired'];
    return this.sql
      .exec(
        `SELECT data, fingerprint, response_id FROM jobs
         WHERE status NOT IN (${skip.map(() => '?').join(',')}) AND updated_at <= ?`,
        ...skip,
        cutoffIso,
      )
      .toArray()
      .map((row) => this.toRow(row));
  }
  /** 한 여행의 최근 작업부터 limit건. */
  listTripJobs(tripId: string, limit: number): StoredJobRow[] {
    return this.sql
      .exec(
        'SELECT data, fingerprint, response_id FROM jobs WHERE trip_id = ? ORDER BY created_at DESC LIMIT ?',
        tripId,
        limit,
      )
      .toArray()
      .map((row) => this.toRow(row));
  }
  countJobs() {
    return count(this.sql.exec('SELECT count(*) AS n FROM jobs').toArray()[0]?.n);
  }
  /** 행 하나를 한 문장으로 쓴다. 상태·결과·사용량·응답 ID가 함께 바뀌거나 함께 남는다. */
  putJob(job: AiV2Job, fingerprint: string, responseId: string | null) {
    const stored = toStoredJob(job);
    this.sql.exec(
      `INSERT INTO jobs (id, trip_id, status, fingerprint, response_id, created_at, updated_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, response_id = excluded.response_id,
         updated_at = excluded.updated_at, data = excluded.data`,
      stored.id,
      stored.tripId,
      stored.status,
      fingerprint,
      responseId,
      stored.createdAt,
      stored.updatedAt,
      JSON.stringify(stored),
    );
  }
  deleteJob(id: string) {
    this.sql.exec('DELETE FROM jobs WHERE id = ?', id);
    this.deleteInflight(id);
  }

  // ── 실행 중 원문 ──
  putInflight(id: string, row: InflightRow) {
    this.sql.exec(
      `INSERT INTO inflight (job_id, input, research, repair) VALUES (?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET input = excluded.input, research = excluded.research, repair = excluded.repair`,
      id,
      row.input,
      row.research,
      row.repair,
    );
  }
  getInflight(id: string): InflightRow | undefined {
    const row = this.sql.exec('SELECT input, research, repair FROM inflight WHERE job_id = ?', id).toArray()[0];
    if (!row) {
      return undefined;
    }
    return {
      input: text(row.input),
      research: typeof row.research === 'string' ? row.research : null,
      repair: text(row.repair),
    };
  }
  deleteInflight(id: string) {
    this.sql.exec('DELETE FROM inflight WHERE job_id = ?', id);
  }
  countInflight() {
    return count(this.sql.exec('SELECT count(*) AS n FROM inflight').toArray()[0]?.n);
  }
  private toRow(row: Record<string, SqlValue>): StoredJobRow {
    return {
      job: toStoredJob(JSON.parse(text(row.data)) as AiV2Job),
      fingerprint: text(row.fingerprint),
      responseId: typeof row.response_id === 'string' ? row.response_id : null,
    };
  }

  // ── 일일 횟수·사용량 ──
  daily(day: string) {
    const row = this.sql.exec('SELECT jobs, total_tokens FROM daily_counts WHERE day = ?', day).toArray()[0];
    return { jobs: count(row?.jobs), totalTokens: count(row?.total_tokens) };
  }
  addDaily(day: string, jobs: number, totalTokens: number) {
    this.sql.exec(
      `INSERT INTO daily_counts (day, jobs, total_tokens) VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET jobs = jobs + excluded.jobs, total_tokens = total_tokens + excluded.total_tokens`,
      day,
      jobs,
      totalTokens,
    );
  }

  // ── 자격·인증 ──
  credentials(): CredentialRow[] {
    return this.sql
      .exec('SELECT id, public_key, counter, transports FROM credentials')
      .toArray()
      .map((row) => ({
        id: text(row.id),
        publicKey: text(row.public_key),
        counter: count(row.counter),
        transports: JSON.parse(text(row.transports) || '[]') as string[],
      }));
  }
  addCredential(credential: CredentialRow, createdAt: string, label = '') {
    this.sql.exec(
      'INSERT INTO credentials (id, public_key, counter, transports, created_at, label) VALUES (?, ?, ?, ?, ?, ?)',
      credential.id,
      credential.publicKey,
      credential.counter,
      JSON.stringify(credential.transports),
      createdAt,
      label,
    );
  }
  /** 등록 순서대로. `ref`는 자격 ID 대신 쓰는 화면용 식별자(rowid)다. */
  credentialSummaries(): CredentialSummary[] {
    return this.sql
      .exec('SELECT rowid AS ref, label, created_at, last_used_at FROM credentials ORDER BY rowid')
      .toArray()
      .map((row) => ({
        ref: String(count(row.ref)),
        label: text(row.label),
        createdAt: text(row.created_at),
        lastUsedAt: typeof row.last_used_at === 'string' ? row.last_used_at : null,
      }));
  }
  credentialIdOf(ref: string) {
    const row = this.sql.exec('SELECT id FROM credentials WHERE rowid = ?', Number(ref)).toArray()[0];
    return row ? text(row.id) : undefined;
  }
  deleteCredential(id: string) {
    this.sql.exec('DELETE FROM credentials WHERE id = ?', id);
  }
  updateCounter(id: string, counter: number, usedAt?: string) {
    this.sql.exec(
      'UPDATE credentials SET counter = ?, last_used_at = coalesce(?, last_used_at) WHERE id = ?',
      counter,
      usedAt ?? null,
      id,
    );
  }
  putChallenge(challenge: string, kind: string, expiresAt: number) {
    this.sql.exec('INSERT INTO challenges (challenge, kind, expires_at) VALUES (?, ?, ?)', challenge, kind, expiresAt);
  }
  /** 챌린지는 한 번만 쓴다. 맞든 틀리든 꺼내는 순간 지운다. */
  takeChallenge(challenge: string, kind: string, now: number) {
    const row = this.sql.exec('SELECT kind, expires_at FROM challenges WHERE challenge = ?', challenge).toArray()[0];
    this.sql.exec('DELETE FROM challenges WHERE challenge = ? OR expires_at < ?', challenge, now);
    return Boolean(row && text(row.kind) === kind && count(row.expires_at) >= now);
  }
  revoke(jti: string, expiresAt: number) {
    this.sql.exec('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)', jti, expiresAt);
  }
  isRevoked(jti: string, now: number) {
    this.sql.exec('DELETE FROM revoked_tokens WHERE expires_at < ?', now);
    return this.sql.exec('SELECT 1 AS hit FROM revoked_tokens WHERE jti = ?', jti).toArray().length > 0;
  }
  setting(key: string) {
    return this.sql.exec('SELECT value FROM settings WHERE key = ?', key).toArray()[0]?.value ?? null;
  }
  putSetting(key: string, value: string) {
    this.sql.exec(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  /** E2E 전용 초기화. 라우터가 로컬 시험 설정에서만 부른다. */
  resetAll() {
    for (const table of [
      'jobs',
      'inflight',
      'credentials',
      'daily_counts',
      'challenges',
      'revoked_tokens',
      'settings',
    ]) {
      this.sql.exec(`DELETE FROM ${table}`);
    }
  }
}
