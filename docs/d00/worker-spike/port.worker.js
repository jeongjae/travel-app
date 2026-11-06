// T-D0 이식성 스파이크: 현재 v2 코드를 고치지 않고 workerd에서 불러 실행해 본다.
import { z } from 'zod';
import { aiV2RequestSchema, aiV2OutputSchema } from '../../src/ai-v2-contract.ts';
import { materializeV2Proposal } from '../../server/ai-v2.ts';
import { canonicalJson, digestBytes } from '../../src/contracts/v2/index.ts';

export default {
  async fetch(request) {
    const { input, output } = await request.json();
    const results = {};
    const step = async (name, run) => {
      try {
        results[name] = await run();
      } catch (error) {
        results[name] = `ERROR ${error.name}: ${String(error.message).slice(0, 120)}`;
      }
    };
    await step(
      'abortSignalAny',
      () => typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function',
    );
    let parsed;
    await step('requestParse', () => {
      parsed = aiV2RequestSchema.parse(input);
      return parsed.context.plan.items.length;
    });
    await step('digest', async () => (await digestBytes(new TextEncoder().encode(canonicalJson(parsed)))).length);
    await step('toJsonSchema', () => Object.keys(z.toJSONSchema(aiV2OutputSchema)).length > 0);
    await step('materialize', () => {
      const research = { text: '가상', sources: [{ url: output.evidence[0].url, title: '가상' }] };
      const op = output.operations[0];
      const first = parsed.context.plan.items[0];
      const draft = {
        ...output,
        operations: [{ ...op, activityId: first.activityId, dayId: first.dayId, placeId: null }],
      };
      return materializeV2Proposal(parsed, draft, research).proposal.status;
    });
    return Response.json(results);
  },
};
