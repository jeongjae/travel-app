// 가짜 OpenAI Responses(background) 서버. 실제 API를 부르지 않는 E2E·로컬 개발용이다.
// Worker는 OPENAI_BASE=http://127.0.0.1:8799/v1 로 이 서버를 본다. 시험은 /__control/* 로 응답을 정한다.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

type Config = {
  /** 생성 직후 몇 번의 조회까지 in_progress로 둘지. */
  pollsBeforeDone: number;
  /** true면 release 전까지 계속 in_progress. */
  hold: boolean;
  researchText: string;
  sources: { url: string; title: string }[];
  /** 작성 호출 순서대로 돌려줄 출력. 모자라면 마지막 값을 다시 쓴다. */
  outputs: unknown[];
  /** true면 생성 호출의 연결을 응답 없이 끊는다(결과 불명 재현). */
  dropCreate: boolean;
  // ── T-D3 고장 주입. 응답 형식은 실제 API와 같고, 시험이 /__control/config로 켠다. ──
  /** 생성 응답을 이 시간(ms)만큼 늦춘다(calling 중 중단 재현). */
  createDelayMs: number;
  /** 생성은 받아 두고(작업이 생김) 연결만 끊는다(생성 후 연결 끊김). */
  dropAfterCreate: boolean;
  /** 결과 조회(GET)를 이 상태 코드로 times번 실패시킨다(404 보관 만료, 5xx 반복). */
  getFailure: { status: number; times: number } | null;
  /** 완료 대신 incomplete(max_output_tokens)로 돌려준다. */
  incomplete: boolean;
  /** 작성 응답을 거절(refusal)로 돌려준다. */
  refuse: boolean;
};

type Stored = { kind: 'research' | 'planning'; polls: number; planningIndex: number };

const defaults = (): Config => ({
  pollsBeforeDone: 1,
  hold: false,
  researchText: '가상 조사 결과',
  sources: [{ url: 'https://example.org/fictional-official', title: '가상 공식 자료' }],
  outputs: [],
  dropCreate: false,
  createDelayMs: 0,
  dropAfterCreate: false,
  getFailure: null,
  incomplete: false,
  refuse: false,
});

let config = defaults();
let responses = new Map<string, Stored>();
let requests: { method: string; path: string; body: unknown }[] = [];
let planningCalls = 0;
let sequence = 0;

function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const usage = { input_tokens: 120, output_tokens: 30, total_tokens: 150 };

function completed(id: string, stored: Stored) {
  if (stored.kind === 'research') {
    return {
      id,
      status: 'completed',
      usage,
      output: [
        { type: 'web_search_call', action: { sources: config.sources } },
        { type: 'message', content: [{ type: 'output_text', text: config.researchText }] },
      ],
    };
  }
  if (config.incomplete) {
    return { id, status: 'incomplete', usage, incomplete_details: { reason: 'max_output_tokens' }, output: [] };
  }
  const output = config.outputs[Math.min(stored.planningIndex, config.outputs.length - 1)];
  if (output === undefined || config.refuse) {
    return { id, status: 'completed', usage, output: [{ type: 'message', content: [{ type: 'refusal' }] }] };
  }
  return {
    id,
    status: 'completed',
    usage,
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  };
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/__control/reset' && req.method === 'POST') {
    config = defaults();
    responses = new Map();
    requests = [];
    planningCalls = 0;
    send(res, 200, { reset: true });
    return;
  }
  if (path === '/__control/config' && req.method === 'POST') {
    config = { ...config, ...(await readBody(req)) };
    send(res, 200, config);
    return;
  }
  if (path === '/__control/requests' && req.method === 'GET') {
    send(res, 200, requests);
    return;
  }
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  requests.push({ method: req.method ?? '', path, body });
  if (path === '/v1/responses' && req.method === 'POST') {
    if (config.dropCreate) {
      req.socket.destroy();
      return;
    }
    if (config.createDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, config.createDelayMs));
    }
    const id = `resp_fake_${++sequence}`;
    const kind = body?.tools ? 'research' : 'planning';
    const planningIndex = kind === 'planning' ? planningCalls++ : 0;
    responses.set(id, { kind, polls: 0, planningIndex });
    if (config.dropAfterCreate) {
      req.socket.destroy();
      return;
    }
    send(res, 200, { id, status: 'queued', background: true });
    return;
  }
  const match = /^\/v1\/responses\/([^/]+)(\/cancel)?$/.exec(path);
  const stored = match ? responses.get(match[1]) : undefined;
  if (!match || !stored) {
    send(res, 404, { error: { message: 'not found' } });
    return;
  }
  if (match[2]) {
    send(res, 200, { id: match[1], status: 'cancelled' });
    return;
  }
  if (config.getFailure && config.getFailure.times > 0) {
    config.getFailure = { ...config.getFailure, times: config.getFailure.times - 1 };
    send(res, config.getFailure.status, { error: { message: 'fake failure' } });
    return;
  }
  stored.polls += 1;
  if (config.hold || stored.polls <= config.pollsBeforeDone) {
    send(res, 200, { id: match[1], status: 'in_progress' });
    return;
  }
  send(res, 200, completed(match[1], stored));
}

const port = Number(process.env.FAKE_OPENAI_PORT || 8799);
createServer((req, res) => {
  handle(req, res).catch(() => send(res, 500, { error: { message: 'fake server error' } }));
}).listen(port, '127.0.0.1', () => console.log(`fake OpenAI: http://127.0.0.1:${port}/v1`));
