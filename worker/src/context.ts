// 환경 값으로 저장소·인증·작업을 조립한다. DO와 단위 시험이 같은 조립을 쓴다.
import { Auth } from './auth.ts';
import type { AppContext } from './app.ts';
import { WorkerJobs, type JobMemory } from './jobs.ts';
import { OpenAiBackground } from './openai.ts';
import { AiStore, type SqlLike } from './store.ts';

/** wrangler.toml [vars]와 비밀값(.dev.vars / wrangler secret). */
export type WorkerVars = {
  OPENAI_API_KEY?: string;
  OPENAI_BASE?: string;
  OPENAI_MODEL?: string;
  TOKEN_SECRET?: string;
  REGISTRATION_CODE?: string;
  RP_ID?: string;
  RP_NAME?: string;
  ALLOWED_ORIGINS?: string;
  E2E_RESET?: string;
};

export type AppRuntime = {
  sql: SqlLike;
  now: () => number;
  schedule: (at: number) => void | Promise<void>;
  fetcher?: typeof fetch;
};

export function createApp(vars: WorkerVars, runtime: AppRuntime): AppContext {
  const store = new AiStore(runtime.sql);
  const memory = new Map<string, JobMemory>();
  const origins = (vars.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const rpId = vars.RP_ID ?? '';
  const openai = new OpenAiBackground({
    base: vars.OPENAI_BASE || 'https://api.openai.com/v1',
    key: vars.OPENAI_API_KEY ?? '',
    model: vars.OPENAI_MODEL || 'gpt-5.4-mini',
    fetcher: runtime.fetcher,
  });
  const auth = new Auth(
    {
      rpId,
      rpName: vars.RP_NAME || 'travel-app',
      origins,
      tokenSecret: vars.TOKEN_SECRET ?? '',
      registrationCode: vars.REGISTRATION_CODE ?? '',
    },
    store,
    runtime.now,
  );
  const jobs = new WorkerJobs({ store, openai, memory, now: runtime.now, schedule: runtime.schedule });
  return {
    store,
    auth,
    jobs,
    origins,
    // 초기화 경로는 로컬(rpId=localhost) 시험 설정에서만 열린다. 운영 RP ID에서는 값을 줘도 닫혀 있다.
    allowReset: vars.E2E_RESET === '1' && rpId === 'localhost',
    onReset: () => memory.clear(),
  };
}
