// workerd 런타임 중 이 Worker가 쓰는 부분만의 최소 선언. @cloudflare/workers-types를 들이지 않으려고 둔다.
declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}

type SqlStorageValue = string | number | null | ArrayBuffer;

interface DurableObjectState {
  storage: {
    sql: {
      exec(query: string, ...bindings: SqlStorageValue[]): { toArray(): Record<string, SqlStorageValue>[] };
    };
    setAlarm(scheduledTime: number): Promise<void>;
  };
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}
