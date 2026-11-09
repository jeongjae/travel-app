// OpenAI Responses background 호출. 생성은 id만 받고 결과는 alarm에서 GET으로 회수한다.
import { rateLimitMessageFor, type ResponseData } from '../../src/ai-v2-openai.ts';

/** 상대가 요청을 받았는지 알 수 없는 실패(연결 끊김·시간 초과). 생성 호출이면 결과 불명(unknown)이다. */
export class OpenAiNetworkError extends Error {}

/** 상대가 응답한 실패. 생성 호출이 거부되었으므로 과금된 작업이 남지 않는다. */
export class OpenAiHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type OpenAiClientOptions = {
  base: string;
  key: string;
  model: string;
  fetcher?: typeof fetch;
};

export class OpenAiBackground {
  private options: OpenAiClientOptions;
  constructor(options: OpenAiClientOptions) {
    this.options = options;
  }
  get model() {
    return this.options.model;
  }
  get configured() {
    return Boolean(this.options.key);
  }
  private async call(path: string, init: RequestInit) {
    const fetcher = this.options.fetcher ?? fetch;
    try {
      return await fetcher(`${this.options.base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.options.key}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new OpenAiNetworkError('OpenAI에 연결하지 못했습니다.');
    }
  }
  private async failure(response: Response): Promise<never> {
    if (response.status === 429) {
      let code = '';
      try {
        const body = (await response.json()) as { error?: { code?: string } };
        code = body.error?.code ?? '';
      } catch {
        code = '';
      }
      throw new OpenAiHttpError(429, rateLimitMessageFor(code));
    }
    await response.body?.cancel();
    throw new OpenAiHttpError(response.status, `OpenAI 요청 실패 (HTTP ${response.status}).`);
  }
  /** background 생성. store:false라도 OpenAI는 폴링을 위해 약 10분 보관한다(결정 11/06 수용). */
  async create(body: Record<string, unknown>): Promise<{ id: string; status: string }> {
    const response = await this.call('/responses', {
      method: 'POST',
      body: JSON.stringify({ model: this.options.model, store: false, background: true, ...body }),
    });
    if (!response.ok) {
      return this.failure(response);
    }
    const data = (await response.json()) as ResponseData;
    if (!data.id) {
      throw new OpenAiHttpError(502, 'OpenAI 응답에 작업 ID가 없습니다.');
    }
    return { id: data.id, status: data.status ?? 'queued' };
  }
  async get(id: string): Promise<ResponseData> {
    const response = await this.call(`/responses/${encodeURIComponent(id)}`, { method: 'GET' });
    if (!response.ok) {
      return this.failure(response);
    }
    return (await response.json()) as ResponseData;
  }
  async cancel(id: string) {
    const response = await this.call(`/responses/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    await response.body?.cancel();
  }
}
