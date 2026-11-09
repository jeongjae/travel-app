// Worker 진입점. 모든 요청을 본인용 단일 Durable Object로 보낸다.
import { DurableObject } from 'cloudflare:workers';
import { handleRequest, type AppContext } from './app.ts';
import { createApp, type WorkerVars } from './context.ts';

export type WorkerEnv = WorkerVars & { AI_STORE: DurableObjectNamespace };

export class AiStoreObject extends DurableObject<WorkerEnv> {
  private app: AppContext;
  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.app = createApp(env, {
      sql: ctx.storage.sql,
      now: () => Date.now(),
      schedule: (at) => ctx.storage.setAlarm(at),
    });
  }
  fetch(request: Request) {
    return handleRequest(request, this.app);
  }
  alarm() {
    return this.app.jobs.tick();
  }
}

export default {
  fetch(request: Request, env: WorkerEnv) {
    const stub = env.AI_STORE.get(env.AI_STORE.idFromName('owner'));
    return stub.fetch(request);
  },
};
