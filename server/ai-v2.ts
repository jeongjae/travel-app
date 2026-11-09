import type { AiV2Output, AiV2PlanningDto, AiV2ResearchDto, AiV2Usage } from '../src/ai-v2-contract.ts';
import {
  assertCompleted,
  planningRequestBody,
  rateLimitMessage,
  readPlan,
  readResearch,
  researchRequestBody,
  usageOf,
  type AiV2Research,
  type ResponseData,
} from '../src/ai-v2-openai.ts';

export { materializeV2Proposal, type AiV2Result } from '../src/ai-v2-semantics.ts';
export { rateLimitMessage } from '../src/ai-v2-openai.ts';
export type Research = AiV2Research;

export type UsageSink = (usage: AiV2Usage) => void;
export interface AiV2Provider {
  model: string;
  research(input: AiV2ResearchDto, signal: AbortSignal, onUsage?: UsageSink): Promise<Research>;
  plan(
    input: AiV2PlanningDto,
    research: Research,
    repair: string,
    signal: AbortSignal,
    onUsage?: UsageSink,
  ): Promise<AiV2Output>;
}

/** Node 개발 서버용 동기 호출 provider. Worker는 같은 본문을 background로 보낸다. */
export class OpenAiV2Provider implements AiV2Provider {
  private key: string;
  private base: string;
  model: string;
  constructor(key: string, model: string, base = 'https://api.openai.com/v1') {
    this.key = key;
    this.model = model;
    this.base = base;
  }
  private async response(body: Record<string, unknown>, signal: AbortSignal, onUsage?: UsageSink) {
    const response = await fetch(`${this.base}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, store: false, ...body }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    });
    if (response.status === 429) {
      throw new Error(await rateLimitMessage(response));
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`OpenAI 요청 실패 (HTTP ${response.status}).`);
    }
    const data = (await response.json()) as ResponseData;
    onUsage?.(usageOf(data));
    assertCompleted(data);
    return data;
  }
  async research(input: AiV2ResearchDto, signal: AbortSignal, onUsage?: UsageSink): Promise<Research> {
    return readResearch(await this.response(researchRequestBody(input), signal, onUsage));
  }
  async plan(input: AiV2PlanningDto, research: Research, repair: string, signal: AbortSignal, onUsage?: UsageSink) {
    return readPlan(await this.response(planningRequestBody(input, research, repair), signal, onUsage));
  }
}
