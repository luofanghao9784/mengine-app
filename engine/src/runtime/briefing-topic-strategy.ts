/** Topic defaults guide editorial choices; they never grant access or establish evidence. */
export const BRIEFING_TOPIC_STRATEGY_VERSION = '1.0.0';
export const BRIEFING_TOPIC_STRATEGY = `画报选题策略 ${BRIEFING_TOPIC_STRATEGY_VERSION}：先从本次获权资料和近期已有画报中筛选候选业务问题，再选择一个有新增价值且可验证的主题。每个候选明确业务问题、所需证据、是否需要计算、与已有内容的区别和预期成果类型。优先满足本次要求与有效选题偏好；企业业务口径、共享发布约束、权限与事实校验始终保留。关注主题、分析方向、成果倾向及减少出现的内容是偏好，不是工具指令或事实。不要把资料数量、字段结构、覆盖时间的介绍当作新洞察，也不要重复改写同一结论。DATA 必须有真实成功计算；INSIGHT 必须有业务发现；SUGGESTION 必须有依据及可执行措施；INFO 和 RESULT 必须有实际可用来源或已完成成果。不按类型配额凑卡。没有新增价值时如实结束，不能声称全部资料已分析完毕。`;

export function briefingPhase(calculated: boolean, lookups: number) {
  return calculated ? 'DELIVERY' : lookups >= 3 ? 'CALCULATION_OR_DELIVERY' : 'RETRIEVAL';
}
export function briefingPhaseAllows(phase: ReturnType<typeof briefingPhase>, tool: string): boolean {
  if (phase === 'DELIVERY') return tool === 'deliver_briefing';
  if (phase === 'CALCULATION_OR_DELIVERY')
    return ['compare_dataset', 'compare_table', 'deliver_briefing', 'task_control'].includes(tool);
  return true;
}

import { isRecord } from './http-json.js';
import { RuntimeError, type TaskTool } from './ports.js';
export function topicSelectionTool(
  invoke: (body: unknown, signal: AbortSignal) => Promise<unknown>,
  selected: (candidate: import('./ports.js').Json) => void,
): TaskTool {
  const text = { type: 'string', description: 'Nonempty text, at most 500 characters' };
  return {
    name: 'select_briefing_topic',
    description:
      'After inspecting authorized sources, record one to three candidate business questions and select ONE with new value compared with recent cards. Call before calculation or delivery. Candidates are editorial proposals, not evidence or authorization. Do not include raw business rows or credentials. EvidenceNeeded states required sources/calculations; difference states actual novelty or evidence gap. DATA requiresCalculation=true. No tool actions or publishing occur here.',
    parameters: {
      type: 'object',
      properties: {
        candidates: {
          type: 'array',
          description: 'One to three candidates',
          items: {
            type: 'object',
            properties: {
              question: text,
              evidenceNeeded: text,
              requiresCalculation: { type: 'boolean' },
              difference: text,
              businessType: { type: 'string', enum: ['DATA', 'INSIGHT', 'SUGGESTION', 'INFO', 'RESULT'] },
            },
            required: ['question', 'evidenceNeeded', 'requiresCalculation', 'difference', 'businessType'],
            additionalProperties: false,
          },
        },
        selectedIndex: { type: 'integer', enum: [0, 1, 2] },
      },
      required: ['candidates', 'selectedIndex'],
      additionalProperties: false,
    },
    async execute(args, signal) {
      if (
        !isRecord(args) ||
        !Array.isArray(args.candidates) ||
        args.candidates.length < 1 ||
        args.candidates.length > 3 ||
        !Number.isInteger(args.selectedIndex) ||
        Number(args.selectedIndex) < 0 ||
        Number(args.selectedIndex) >= args.candidates.length
      )
        throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
      for (const c of args.candidates)
        if (
          !isRecord(c) ||
          ['question', 'evidenceNeeded', 'difference'].some(
            (k) => typeof c[k] !== 'string' || !(c[k] as string).trim() || (c[k] as string).length > 500,
          ) ||
          typeof c.requiresCalculation !== 'boolean' ||
          !['DATA', 'INSIGHT', 'SUGGESTION', 'INFO', 'RESULT'].includes(String(c.businessType)) ||
          (c.businessType === 'DATA' && !c.requiresCalculation)
        )
          throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
      const result = await invoke(args, signal);
      if (
        !isRecord(result) ||
        result.recorded !== true ||
        result.proposalOnly !== true ||
        result.selectedIndex !== args.selectedIndex ||
        result.strategyVersion !== BRIEFING_TOPIC_STRATEGY_VERSION
      )
        throw new RuntimeError('INVALID_REMOTE_RESPONSE');
      selected(args.candidates[Number(args.selectedIndex)] as import('./ports.js').Json);
      return { ...result, selectedCandidate: args.candidates[Number(args.selectedIndex)] };
    },
  };
}

export function topicNextTool(
  needsCalculation: boolean,
  calculationAttempts: number,
  datasetAvailable: boolean,
  tableAvailable: boolean,
): string | undefined {
  if (!needsCalculation) return 'deliver_briefing';
  if (calculationAttempts > 0) return undefined;
  return datasetAvailable ? 'compare_dataset' : tableAvailable ? 'compare_table' : undefined;
}
