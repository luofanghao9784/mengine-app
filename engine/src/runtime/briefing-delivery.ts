import { BRIEFING_WRITING_RULES } from './briefing-writing-rules.js';
import { isRecord } from './http-json.js';
import { RuntimeError, type Json, type TaskTool } from './ports.js';
/** Protocol guidance only. Placeholder text is never business evidence. */
export const BRIEFING_EDITORIAL_HINTS: Record<string, string> = {
  BRIEFING_PRESENTATION_INVALID:
    'Choose a supported presentation layout/chartStyle; sections must reference distinct existing analysis paragraph indices (0-based). STEPS only for SUGGESTION with ACTION/CAUTION; COMPARISON only INSIGHT/SUGGESTION with at least two OPTION sections. DATA only EDITORIAL/KEY_METRIC, chartStyle required. focusGroup must exactly match a verified calculation group and is only allowed for KEY_METRIC. Do not submit numbers, URLs, HTML, CSS or code.',
  BRIEFING_TYPE_MISMATCH:
    'Keep businessType equal to the platform requested or selected-topic briefing type. A completed calculation does not change the requested type. For SUGGESTION deliver evidence-grounded actions, omit calculationArtifactId and avoid unsupported quantitative claims. If no useful content of the requested type is supported, use the status-only receipt; do not substitute DATA.',
  BRIEFING_INTERNAL_LANGUAGE:
    'Rewrite user-visible title, summary and paragraphs in business Chinese. Remove tool names, raw IDs and raw status codes; e.g. deposit means 定金, canceled means 已取消, finance_confirmed means 财务已确认, never proof of refund or cash receipt.',
  BRIEFING_NO_BUSINESS_INSIGHT:
    'A schema inventory is not a business insight. Deliver one supported business finding or use the status-only 暂无新内容 receipt; do not pad content with columns or tool limitations.',
  BRIEFING_UNVERIFIED_QUANTITY:
    'Sample observations do not prove majority, share, growth or rank. Remove quantitative claims unless a verified full-snapshot comparison supports them. A fixed date-to-month comparison is available; never fabricate a statistical result.',
  BRIEFING_RATIO_NOT_VERIFIED:
    '标题、摘要及每段正文均删除“占比”“比例”“多数”“大多数”“主要形式”等未经核验的构成表述，包括增长比例等措辞。分组金额计算只证明金额及两期变化；改为具体金额与“较前期增加/减少X%”（仅使用计算中的 changePercent），或明确限定的个别观察。检查所有段落后重新交付，不补造分母、不重复原稿。',
};
export const BRIEFING_ANALYSIS_ARRAY_HINT =
  'analysis must be a JSON array of paragraph strings, for example {"analysis":["First complete evidence-grounded paragraph.","Second complete evidence-grounded paragraph."]}. Replace placeholders with supported business content. Do not send analysis as one string, a Markdown block, or a string containing serialized JSON. Preserve the title and summary fields; correct the analysis type before calling deliver_briefing again.';

/** Preserve words; accept only a bounded serialized array or existing paragraph separators. */
export function normalizeBriefingArguments(value: unknown): unknown {
  if (!isRecord(value) || typeof value.analysis !== 'string' || value.analysis.length > 2200) return value;
  let paragraphs: unknown;
  try {
    paragraphs = JSON.parse(value.analysis);
  } catch {
    paragraphs = value.analysis.split(/\r?\n\s*\r?\n/).map((p) => p.trim());
    if (Array.isArray(paragraphs) && paragraphs.length === 1)
      paragraphs = value.analysis.split(/\r?\n/).map((p) => p.trim());
  }
  if (
    !Array.isArray(paragraphs) ||
    paragraphs.length < 2 ||
    paragraphs.length > 4 ||
    paragraphs.some((p) => typeof p !== 'string' || p.length < 12 || p.length > 500)
  )
    return value;
  return { ...value, analysis: paragraphs };
}

export function briefingDeliveryTool(options: {
  presentationAvailable?: boolean;
  requestedType?: string;
  selectedType?(): string | undefined;
  authorize(): Promise<void>;
  invoke(body: unknown, signal: AbortSignal): Promise<unknown>;
}): TaskTool {
  return {
    name: 'deliver_briefing',
    normalizeArguments: normalizeBriefingArguments,
    description:
      'Create a real private briefing card on 智能画报. Set businessType to INFO (资讯), DATA (数据), INSIGHT (洞察), SUGGESTION (建议), or RESULT (成果). For text categories omit calculationArtifactId and use actual granted evidence; only DATA requires the calculation below. Do not create cards for greetings or routine status replies; create for a complete useful theme or an explicit user request. Only DATA requires compare_table (XLSX) or compare_dataset (collected database snapshot) and its artifact.id; INFO, INSIGHT, SUGGESTION and RESULT use granted evidence without a calculation. Write a short editorial title, summary and 2–4 analysis paragraphs grounded in that calculation and source scope. Summary and each paragraph must be complete sentences ending in punctuation. Distinguish observed changes from unverified causes. Chart values, periods, units and provenance are taken by the platform from the verified calculation, never from model-supplied numbers. One immutable card per task attempt, private to the current user, visible only after successful task delivery. After PREPARED, finish with a short confirmation; NO_NEW_CONTENT means a duplicate was suppressed, so report no new card; do not repeat raw IDs, hashes or the entire report. This is not enterprise publication or a scheduled plan.' +
      '\n' +
      BRIEFING_WRITING_RULES +
      '\n' +
      BRIEFING_ANALYSIS_ARRAY_HINT +
      (options.presentationAvailable
        ? '\nChoose presentation according to the business question, not random decoration. version=briefing-presentation-v1. DATA: GROUPED_BAR for a few two-period groups; DUMBBELL for paired comparisons across many groups; DELTA_BAR for verified increases/decreases; CURRENT_BAR for current-period ranking; TABLE for exact values and gaps. KEY_METRIC highlights CURRENT, DIFFERENCE or CHANGE_PERCENT from the verified totals (focusGroup=null) or an exact group. No long-term trend, share, funnel or progress claims from a two-period sum. Non-DATA: EDITORIAL for prose or labeled analysis sections, STEPS for actual recommended actions, COMPARISON for actual supported options, SOURCE for a source filename cover (not proof of a generated file). sections selects 0-based analysis paragraphIndex with OBSERVATION/INTERPRETATION/ACTION/OPTION/CAUTION roles. At least two ACTION/CAUTION sections for STEPS, two OPTION sections for COMPARISON. Do not relabel observations as actions/options. Keep the full analysis; composition never adds facts, executable code, media URLs or chart numbers.'
        : ''),
    parameters: {
      type: 'object',
      properties: {
        ...(options.presentationAvailable
          ? {
              presentation: {
                type: 'object',
                properties: {
                  version: { type: 'string', enum: ['briefing-presentation-v1'] },
                  layout: {
                    type: 'string',
                    enum: ['EDITORIAL', 'KEY_METRIC', 'STEPS', 'COMPARISON', 'SOURCE'],
                  },
                  chartStyle: {
                    oneOf: [
                      {
                        type: 'string',
                        enum: ['GROUPED_BAR', 'DUMBBELL', 'DELTA_BAR', 'CURRENT_BAR', 'TABLE'],
                      },
                      { type: 'null' },
                    ],
                  },
                  focusGroup: {
                    oneOf: [{ type: 'string' }, { type: 'null' }],
                    description: 'Exact verified group, max 100 characters; null means totals',
                  },
                  focusValue: {
                    oneOf: [
                      { type: 'string', enum: ['CURRENT', 'DIFFERENCE', 'CHANGE_PERCENT'] },
                      { type: 'null' },
                    ],
                  },
                  sections: {
                    type: 'array',
                    description: 'At most 4 distinct existing paragraphs',
                    items: {
                      type: 'object',
                      properties: {
                        role: {
                          type: 'string',
                          enum: ['OBSERVATION', 'INTERPRETATION', 'ACTION', 'OPTION', 'CAUTION'],
                        },
                        paragraphIndex: { type: 'integer', enum: [0, 1, 2, 3] },
                      },
                      required: ['role', 'paragraphIndex'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['version', 'layout', 'chartStyle', 'focusGroup', 'focusValue', 'sections'],
                additionalProperties: false,
              },
            }
          : {}),
        businessType: {
          type: 'string',
          enum: options.requestedType
            ? [options.requestedType]
            : ['INFO', 'DATA', 'INSIGHT', 'SUGGESTION', 'RESULT'],
        },
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
            'JSON array of strings, NOT a single string. Each array item is one complete evidence-grounded paragraph, 12–500 characters, ending in sentence punctuation. Use 2–4 items, e.g. ["First grounded paragraph.","Second grounded paragraph."]. Never JSON-stringify the array.',
        },
      },
      required: [
        'title',
        'summary',
        'analysis',
        ...(options.presentationAvailable ? ['presentation'] : []),
        ...(options.requestedType ? ['businessType'] : []),
      ],
      additionalProperties: false,
    },
    async execute(args, signal) {
      const requiredType = options.requestedType || options.selectedType?.();
      if (requiredType && (!isRecord(args) || args.businessType !== requiredType))
        throw new RuntimeError('BRIEFING_TYPE_MISMATCH');
      await options.authorize();
      const r = await options.invoke(args, signal);
      await options.authorize();
      if (
        !isRecord(r) ||
        r.contractVersion !== '1.0' ||
        (!(
          r.status === 'NO_NEW_CONTENT' &&
          ['DUPLICATE_CONTENT', 'NO_USEFUL_CONTENT'].includes(String(r.reason))
        ) &&
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
    ((r.status === 'NO_NEW_CONTENT' &&
      ['DUPLICATE_CONTENT', 'NO_USEFUL_CONTENT'].includes(String(r.reason))) ||
      (r.status === 'PREPARED' &&
        typeof r.artifactId === 'string' &&
        /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(r.artifactId) &&
        r.visibility === 'PRIVATE_AFTER_TASK_SUCCEEDS'))
  );
}

/** Native card delivery can recover earlier rejected delivery arguments; other failed work remains partial. */
export function hasTerminalBriefing(tools: Parameters<typeof hasPreparedBriefing>[0]): boolean {
  const last = tools.at(-1);
  return (
    !!last &&
    hasPreparedBriefing([last]) &&
    tools
      .slice(0, -1)
      .every(
        (tool) =>
          tool.status === 'succeeded' || (tool.name === 'deliver_briefing' && tool.status === 'failed'),
      )
  );
}
