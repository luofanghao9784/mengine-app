import { isRecord } from './http-json.js';
import { RuntimeError, type Json, type TaskTool } from './ports.js';
export function briefingDeliveryTool(options: {
  authorize(): Promise<void>;
  invoke(body: unknown, signal: AbortSignal): Promise<unknown>;
}): TaskTool {
  return {
    name: 'deliver_briefing',
    description:
      'Create a real private briefing card on 智能画报. Set businessType to INFO (资讯), DATA (数据), INSIGHT (洞察), SUGGESTION (建议), or RESULT (成果). For text categories omit calculationArtifactId and use actual granted evidence; only DATA requires the calculation below. Do not create cards for greetings or routine status replies; create for a complete useful theme or an explicit user request. Only DATA requires compare_table (XLSX) or compare_dataset (collected database snapshot) and its artifact.id; INFO, INSIGHT, SUGGESTION and RESULT use granted evidence without a calculation. Write a short editorial title, summary and 2–4 analysis paragraphs grounded in that calculation and source scope. Summary and each paragraph must be complete sentences ending in punctuation. Distinguish observed changes from unverified causes. Chart values, periods, units and provenance are taken by the platform from the verified calculation, never from model-supplied numbers. One immutable card per task attempt, private to the current user, visible only after successful task delivery. After PREPARED, finish with a short confirmation; NO_NEW_CONTENT means a duplicate was suppressed, so report no new card; do not repeat raw IDs, hashes or the entire report. This is not enterprise publication or a scheduled plan.',
    parameters: {
      type: 'object',
      properties: {
        businessType: { type: 'string', enum: ['INFO', 'DATA', 'INSIGHT', 'SUGGESTION', 'RESULT'] },
        calculationArtifactId: {
          type: 'string',
          description: 'artifact.id from this attempt’s successful compare_table or compare_dataset',
        },
        title: {
          type: 'string',
          description: 'Specific editorial title, 4–80 characters; not the user prompt',
        },
        summary: {
          type: 'string',
          description: 'Complete conclusion, 12–240 characters, ending 。!? or equivalent',
        },
        analysis: {
          type: 'array',
          items: { type: 'string' },
          description:
            '2–4 complete evidence-grounded paragraphs, 12–500 characters each, each ending in sentence punctuation',
        },
      },
      required: ['title', 'summary', 'analysis'],
      additionalProperties: false,
    },
    async execute(args, signal) {
      await options.authorize();
      const r = await options.invoke(args, signal);
      await options.authorize();
      if (
        !isRecord(r) ||
        r.contractVersion !== '1.0' ||
        (!(r.status === 'NO_NEW_CONTENT' && r.reason === 'DUPLICATE_CONTENT') &&
          (r.status !== 'PREPARED' ||
            typeof r.artifactId !== 'string' ||
            typeof r.title !== 'string' ||
            r.visibility !== 'PRIVATE_AFTER_TASK_SUCCEEDS'))
      )
        throw new RuntimeError('BRIEFING_RECEIPT_INVALID');
      return r as Json;
    },
  };
}

/** A persisted deliverable is evidence; elapsed time and model prose are not. */
export function hasPreparedBriefing(
  tools: readonly { name: string; status: string; output?: unknown }[],
): boolean {
  const last = tools.at(-1);
  const r = last?.output;
  return (
    tools.every((t) => t.status === 'succeeded') &&
    last?.name === 'deliver_briefing' &&
    isRecord(r) &&
    r.contractVersion === '1.0' &&
    ((r.status === 'NO_NEW_CONTENT' && r.reason === 'DUPLICATE_CONTENT') ||
      (r.status === 'PREPARED' &&
        typeof r.artifactId === 'string' &&
        /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(r.artifactId) &&
        r.visibility === 'PRIVATE_AFTER_TASK_SUCCEEDS'))
  );
}
