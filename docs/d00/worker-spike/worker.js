// T-D0 스파이크: 저장소 후보(SQLite DO + alarm + background 응답 폴링)가 로컬 workerd에서 성립하는지만 본다. 제품 코드 아님.
import { DurableObject } from 'cloudflare:workers';

export class JobStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, fingerprint TEXT, status TEXT, responseId TEXT, result TEXT, polls INT DEFAULT 0)',
    );
  }
  row(id) {
    return this.ctx.storage.sql.exec('SELECT * FROM jobs WHERE id=?', id).toArray()[0];
  }
  async fetch(request) {
    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();
    if (request.method === 'GET') {
      const row = this.row(id);
      return Response.json(row ?? { error: 'none' }, { status: row ? 200 : 404 });
    }
    const { fingerprint } = await request.json();
    const existing = this.row(id);
    if (existing) {
      return existing.fingerprint === fingerprint
        ? Response.json(existing)
        : Response.json({ error: 'same id, different body' }, { status: 409 });
    }
    // 외부 호출 전에 의도(intent)를 먼저 남긴다. alarm이 다시 돌아도 재호출하지 않는 근거다.
    this.ctx.storage.sql.exec("INSERT INTO jobs(id,fingerprint,status) VALUES(?,?,'queued')", id, fingerprint);
    await this.ctx.storage.setAlarm(Date.now() + 50);
    return Response.json(this.row(id), { status: 202 });
  }
  async alarm() {
    const rows = this.ctx.storage.sql
      .exec("SELECT * FROM jobs WHERE status IN ('queued','calling','polling')")
      .toArray();
    for (const job of rows) {
      if (job.status === 'calling') {
        // 생성 호출 도중 죽었다: 처리·과금 여부를 모르므로 다시 부르지 않는다.
        this.ctx.storage.sql.exec("UPDATE jobs SET status='unknown' WHERE id=?", job.id);
      } else if (job.status === 'queued') {
        this.ctx.storage.sql.exec("UPDATE jobs SET status='calling' WHERE id=?", job.id);
        const created = await fetch(`${this.env.OPENAI_BASE}/v1/responses`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ background: true, store: false, input: 'fictional' }),
        }).then((response) => response.json());
        this.ctx.storage.sql.exec("UPDATE jobs SET status='polling', responseId=? WHERE id=?", created.id, job.id);
      } else {
        const polled = await fetch(`${this.env.OPENAI_BASE}/v1/responses/${job.responseId}`).then((r) => r.json());
        this.ctx.storage.sql.exec('UPDATE jobs SET polls=polls+1 WHERE id=?', job.id);
        if (polled.status === 'completed') {
          this.ctx.storage.sql.exec(
            "UPDATE jobs SET status='done', result=? WHERE id=?",
            JSON.stringify(polled),
            job.id,
          );
        }
      }
    }
    const left = this.ctx.storage.sql
      .exec("SELECT count(*) c FROM jobs WHERE status IN ('queued','calling','polling')")
      .one().c;
    if (left) {
      await this.ctx.storage.setAlarm(Date.now() + 200);
    }
  }
}

function cors(env, origin) {
  return origin === env.ALLOW_ORIGIN
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = cors(env, origin);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: origin === env.ALLOW_ORIGIN ? 204 : 403, headers });
    }
    if (origin && origin !== env.ALLOW_ORIGIN) {
      return Response.json({ error: 'origin' }, { status: 403, headers });
    }
    if (request.headers.get('Authorization') !== `Bearer ${env.SPIKE_TOKEN}`) {
      return Response.json({ error: 'auth' }, { status: 401, headers });
    }
    const stub = env.JOBS.get(env.JOBS.idFromName('owner'));
    const response = await stub.fetch(request);
    return new Response(response.body, {
      status: response.status,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  },
};
