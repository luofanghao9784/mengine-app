import { BRIEFING_WRITING_RULES } from './briefing-writing-rules.js';
import { isRecord } from './http-json.js';
import { RuntimeError, type Json, type TaskTool } from './ports.js';
/** Protocol guidance only. Placeholder text is never business evidence. */
export const BRIEFING_EDITORIAL_HINTS: Record<string, string> = {
  BRIEFING_EDITORIAL_PLAN_REQUIRED: '先完成通用整批规划，关联实际岗位目标；不能绕过选题直接交付。',
  BRIEFING_COMPONENT_MISMATCH: '使用已记录内容形态对应的组件；不得为出图编造计算，不能把观察写成步骤。',
  BRIEFING_COMPONENT_DATA_MISMATCH: '实际图表行数与规划不符。保留证据缺口，不伪造分组或数值。',
  BRIEFING_CALCULATION_REQUIRED: '此选题需要真实成功计算回执，不能用模型数字代替。',

  BRIEFING_DESTINATION_MISMATCH: "选题应归知识草案、治理待确认或无输出，不能将业务理解过程发布为画报。结束本次并说明去向；未发布知识不能声称已入库。",
  FUSION_ANALYSIS_INCOMPLETE: '融合画报需要在正文中同时使用 fusion.results 至少两项相关指标的完整 label，并结合共同维度解读；不能只解释主指标。',
  FUSION_NUMBER_NOT_VERIFIED: '正文只可引用 fusion 中已计算的原始数值；删除自行计算、四舍五入、推断的数字及比率。完整精确表格将自动交付，无需在正文重复数字。',
  BRIEFING_TEXT_INCOMPLETE: '标题为4–80字；摘要为12–240字；正文为2–4段、每段12–500字。摘要和每段正文均以句号、问号或叹号结束，不以括号或引号结束；保留有依据的内容，不补造事实。',
  BRIEFING_ANALYSIS_REQUIRED: 'analysis 必须为2–4个完整段落组成的字符串数组，每段12–500字，不是单个字符串。',

  BRIEFING_TITLE_TOPIC_ONLY:
    '数据卡卡面不显示摘要。标题只说主题，请改为来源支持的结论，尽量含关键数字或方向，建议不超过28字；不要为了改标题编造事实。',
  BRIEFING_PRESENTATION_INVALID:
    'Choose a supported presentation layout/chartStyle; sections must reference distinct existing analysis paragraph indices (0-based). STEPS only for SUGGESTION with ACTION/CAUTION; COMPARISON only INSIGHT/SUGGESTION with at least two OPTION sections. DATA only EDITORIAL/KEY_METRIC, chartStyle required. focusGroup must exactly match a verified calculation group and is only allowed for KEY_METRIC. Do not submit numbers, URLs, HTML, CSS or code.',
  BRIEFING_TYPE_MISMATCH:
    'Keep businessType equal to the platform requested or selected-topic briefing type. A completed calculation does not change the requested type. For SUGGESTION deliver evidence-grounded actions, attach calculationArtifactId only when a successful calculation supports the statements, and avoid unsupported quantitative claims. If no useful content of the requested type is supported, use the status-only receipt; do not substitute DATA.',
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
  textCalculationAvailable?: boolean;
  isSummaryCalculation?(artifactId: unknown): boolean;
  requestedType?: string;
  selectedType?(): string | undefined;
  selectedShape?(): string | undefined;
  authorize(): Promise<void>;
  invoke(body: unknown, signal: AbortSignal): Promise<unknown>;
}): TaskTool {
  return {
    name: 'deliver_briefing',
    normalizeArguments(value: unknown) {
      const normalized = normalizeBriefingArguments(value);
      if (!options.presentationAvailable || !isRecord(normalized)) return normalized;
      const copy = { ...normalized };
      if (typeof copy.presentation === 'string' && copy.presentation.length <= 2048) {
        try { copy.presentation = JSON.parse(copy.presentation); } catch { /* schema rejection retains feedback */ }
      }
      // A conservative composition requires no guessed numbers, section roles or emphasis.
      // Explicit malformed presentations still fail validation; valid model choices are preserved.
      if (copy.presentation === undefined) copy.presentation = {
        version: 'briefing-presentation-v1', layout: 'EDITORIAL',
        chartStyle: copy.businessType === 'DATA' || options.requestedType === 'DATA' ? (options.isSummaryCalculation?.(copy.calculationArtifactId) ? 'CURRENT_BAR' : 'GROUPED_BAR') : null,
        focusGroup: null, focusValue: null, sections: [],
      };
      return copy;
    },
    description:
      'Create a real private briefing card on 智能画报. Set businessType to INFO (资讯), DATA (数据), INSIGHT (洞察), SUGGESTION (建议), or RESULT (成果). For INSIGHT/SUGGESTION/RESULT optionally attach calculationArtifactId from a verified calculation as evidence; keep the text type and layout without chartStyle. INFO omits calculationArtifactId and uses verified sources. Do not create cards for greetings or routine status replies; create for a complete useful theme or an explicit user request. Only DATA requires compare_table (XLSX) or compare_dataset (collected database snapshot) and its artifact.id; INSIGHT/SUGGESTION/RESULT may use the same verified calculation receipts without becoming DATA. Write a short editorial title, summary and 2–4 analysis paragraphs grounded in that calculation and source scope. Summary and each paragraph must be complete sentences ending in punctuation. Distinguish observed changes from unverified causes. Chart values, periods, units and provenance are taken by the platform from the verified calculation, never from model-supplied numbers. One immutable card per task attempt, private to the current user, visible only after successful task delivery. After PREPARED, finish with a short confirmation; NO_NEW_CONTENT means duplicate or empty verified data was suppressed, so report no new card; do not repeat raw IDs, hashes or the entire report. This is not enterprise publication or a scheduled plan.' +
      '\n' +
      BRIEFING_WRITING_RULES +
      '\n' +
      BRIEFING_ANALYSIS_ARRAY_HINT +
      (options.presentationAvailable
        ? '\nChoose presentation according to the business question, not random decoration. version=briefing-presentation-v1. Send presentation as a JSON OBJECT, never a string. Minimal DATA example: {"version":"briefing-presentation-v1","layout":"EDITORIAL","chartStyle":"GROUPED_BAR","focusGroup":null,"focusValue":null,"sections":[]}. Minimal text example uses the same object with chartStyle:null. DATA: GROUPED_BAR compares the same metric across two periods: up to 6 groups appear as a slope chart highlighting the largest increase; title the main change or overall direction. Category comparisons or more than 6 groups use paired thin bars. DUMBBELL has the same card face as GROUPED_BAR and remains for compatibility. DELTA_BAR emphasizes verified increases/decreases. CURRENT_BAR ranks current values or period summaries. TABLE is an explicit choice when readers need to check exact values individually. Use KEY_METRIC when the conclusion centers on a single value; specify focusGroup (null for totals) and focusValue. It highlights CURRENT, DIFFERENCE or CHANGE_PERCENT from the verified totals (focusGroup=null) or an exact group. No long-term trend, share, funnel or progress claims from a two-period sum. Non-DATA: EDITORIAL for prose or labeled analysis sections, STEPS for SUGGESTION with two or more explicit recommended actions, COMPARISON for two or more actual supported options, SOURCE for a source filename cover (not proof of a generated file). sections selects 0-based analysis paragraphIndex with OBSERVATION/INTERPRETATION/ACTION/OPTION/CAUTION roles. At least two ACTION/CAUTION sections for STEPS, two OPTION sections for COMPARISON. Do not relabel observations as actions/options. Keep the full analysis; composition never adds facts, executable code, media URLs or chart numbers.'
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
          description: 'artifact.id from this attempt’s successful compare_table, compare_dataset or installed briefing_plan; required for DATA or a topic requiring calculation',
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
      if (isRecord(args) && args.calculationArtifactId != null && args.businessType && args.businessType !== 'DATA' &&
          (args.businessType === 'INFO' || options.textCalculationAvailable === false))
        throw new RuntimeError('BRIEFING_TEXT_CALCULATION_UNAVAILABLE');
      await options.authorize();
      // Match the backend's cross-field constraints before a remote write, with
      // precise repair guidance. Never relabel paragraphs or rewrite business text.
      const statusOnly = isRecord(args) && typeof args.title === 'string' && /^(?:(?:暂无|没有|无)(?:新的?|新增)?(?:内容|画报|卡片|结果)[。.!！]*|no new (?:content|briefing|cards?)[.!]*)$/i.test(args.title.trim());
      if (!statusOnly && options.presentationAvailable && isRecord(args) && isRecord(args.presentation)) {
        const p = args.presentation, shape = options.selectedShape?.();
        const expected = shape ? ({STEPS:'STEPS', OPTIONS:'COMPARISON', NEWS:'SOURCE', SINGLE_FACT:'KEY_METRIC'}[shape] ?? 'EDITORIAL') : undefined;
        if (expected && p.layout !== expected)
          throw new RuntimeError('BRIEFING_COMPONENT_MISMATCH', `已登记形态为 ${shape}，presentation.layout 必须为 ${expected}；保留已有证据与选题，不切换版式来绕过校验。`);
        if (args.businessType !== 'DATA' && [p.chartStyle,p.focusGroup,p.focusValue].some(v=>v != null))
          throw new RuntimeError('BRIEFING_PRESENTATION_INVALID', '文字画报的 chartStyle、focusGroup、focusValue 必须全部为 null，不要填写空字符串或 CURRENT。');
        if (Array.isArray(args.analysis) && Array.isArray(p.sections)) {
          const count=args.analysis.length, indices=new Set();
          for (const section of p.sections) {
            if (!isRecord(section) || !Number.isInteger(section.paragraphIndex) || Number(section.paragraphIndex)<0 || Number(section.paragraphIndex)>=count || indices.has(section.paragraphIndex))
              throw new RuntimeError('BRIEFING_PRESENTATION_INVALID', `analysis 共有 ${count} 段，paragraphIndex 只能使用 0 到 ${count-1}，且不可重复。无需为每段设置 section；保留原文，只修正实际段落索引。`);
            indices.add(section.paragraphIndex);
          }
          if (p.layout==='STEPS' && (p.sections.length<2 || p.sections.some(s=>!isRecord(s)||!['ACTION','CAUTION'].includes(String(s.role)))))
            throw new RuntimeError('BRIEFING_PRESENTATION_INVALID', 'STEPS 至少选择两个真实行动或注意事项段落，role 仅允许 ACTION 或 CAUTION。背景观察段落保留在 analysis，不加入 sections；不要把观察伪装成行动。');
          if (p.layout==='COMPARISON' && p.sections.filter(s=>isRecord(s)&&s.role==='OPTION').length<2)
            throw new RuntimeError('BRIEFING_PRESENTATION_INVALID', 'COMPARISON 至少标注两个有依据的不同方案段落为 OPTION，不编造方案。');
        }
      }
      if (isRecord(args) && (args.businessType === 'DATA' || requiredType === 'DATA') &&
          typeof args.title === 'string' && /(?:分析|分布|情况)[。！!]?$/u.test(args.title.trim()) &&
          !/(?:增长|增加|减少|下降|上升|高于|低于|最多|最少|领先|落后|翻倍|持平|为零)/u.test(args.title))
        throw new RuntimeError('BRIEFING_TITLE_TOPIC_ONLY', BRIEFING_EDITORIAL_HINTS.BRIEFING_TITLE_TOPIC_ONLY);
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
