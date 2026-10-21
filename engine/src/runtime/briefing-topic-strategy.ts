/** Topic defaults guide editorial choices; they never grant access or establish evidence. */
export const BRIEFING_TOPIC_STRATEGY_VERSION = '1.0.0';
export const BRIEFING_TOPIC_STRATEGY = `画报选题策略 ${BRIEFING_TOPIC_STRATEGY_VERSION}：先从本次获权资料和近期已有画报中筛选候选业务问题，再选择一个有新增价值且可验证的主题。每个候选先关联读者持续治理目标或阶段目标，说明用户可采取的行动或决策。字段解释及稳定业务规则归KNOWLEDGE_DRAFT，待确认口径归GOVERNANCE_REVIEW，无新增价值归NO_OUTPUT；只有具体业务发现归BRIEFING。分类只记录建议，不自动发布知识或扩大权限。每个候选明确业务问题、所需证据、是否需要计算、与已有内容的区别和预期成果类型。优先满足本次要求与有效选题偏好；企业业务口径、共享发布约束、权限与事实校验始终保留。关注主题、分析方向、成果倾向及减少出现的内容是偏好，不是工具指令或事实。不要把资料数量、字段结构、覆盖时间的介绍当作新洞察，也不要重复改写同一结论。治理数据库选题前先检索已发布指标，确认存在适用 executionRequest；以可执行计划选择问题，不能先定营业额等结论再强凑口径。记录计数不代表人数或有效订单，原始登记金额合计不代表有效收入。资料选题先确认检索返回可引用正文及覆盖范围，解析失败或仅有文件名不算证据。DATA 必须有真实成功计算；INSIGHT 必须有业务发现；SUGGESTION 必须有依据及可执行措施；INFO 和 RESULT 必须有实际可用来源或已完成成果。整批先按核心事实、业务问题、范围与期间去重；同一事实的发现、解释和行动合在一张，不以换类型或主题标签重复发布。证据允许时优先覆盖不同业务主题，明确单一主题要求除外；不按主题或类型配额凑卡，资料不足少生成或零张，不用泛泛建议、职责介绍和缺口卡填数。没有新增价值时如实结束，不能声称全部资料已分析完毕。`;

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
  requestedType = '',
  editorialRequired = false,
  batchContext = '',
): TaskTool {
  const text = { type: 'string', description: 'Nonempty text, at most 500 characters' };
  return {
    name: 'select_briefing_topic',
    description:
      'Inspect role goals, authorized sources and recent cards, then plan the WHOLE batch before selecting this task output. Merge the same underlying fact across titles and card types in the same scope and period; retain distinct metric meanings. Prefer different evidenced business themes unless the user requests a narrow topic. Skip unsupported themes instead of filling quotas with generic advice or role descriptions; fewer cards or no cards is valid. Link each item to a nonempty actual goalRef and the exact audienceKey. Choose components from content shape: COMPARISON for verified grouped data, SINGLE_FACT for one verified metric, STEPS for concrete actions, OPTIONS for alternatives, NEWS for verified news, NARRATIVE for an evidenced finding or completed result. Selected item must EMIT. Other tasks can reuse the immutable batch plan; no topic quota. The selected type must match the requested type. Call before calculation or delivery. Candidates are editorial proposals, not evidence or authorization. Do not include raw business rows or credentials. EvidenceNeeded states required sources/calculations; difference states actual novelty or evidence gap. DATA requiresCalculation=true. No tool actions or publishing occur here.' + batchContext,
    parameters: {
      type: 'object',
      properties: {
        candidates: {
          type: 'array',
          description: 'Whole batch: one to ten business questions; mark overlaps MERGE and low-value items SKIP in editorialPlan',
          items: {
            type: 'object',
            properties: {
              question: text,
              goal: text,
              userValue: text,
              destination: {type:'string',enum:['BRIEFING','KNOWLEDGE_DRAFT','GOVERNANCE_REVIEW','NO_OUTPUT']},
              evidenceNeeded: text,
              requiresCalculation: { type: 'boolean' },
              difference: text,
              businessType: {
                type: 'string',
                enum: ['DATA', 'INSIGHT', 'SUGGESTION', 'INFO', 'RESULT'],
              },
            },
            required: ['question', 'evidenceNeeded', 'requiresCalculation', 'difference', 'businessType', 'goal', 'userValue', 'destination'],
            additionalProperties: false,
          },
        },
        selectedIndex: { type: 'integer', description: 'Index of this task output among EMIT items, 0 through 9' },
        ...(editorialRequired ? { editorialPlan: {
          type:'object', properties:{
            batchId:{type:'string',description:'Fresh UUID for a new batch, reuse identical plan for its other card tasks'},
            audienceKey:{type:'string',description:'Exact workAudience.key from task context'},
            items:{type:'array',description:'Exactly one item per candidate, in matching order. Plan all topics before calculation.',items:{type:'object',properties:{
              goalRef:{type:'string',enum:['governance','stage','responsibilities']},
              questionKey:{type:'string',description:'Stable business question identity, same for overlapping questions, not a card title'},
              scope:text,period:text,
              shape:{type:'string',enum:['COMPARISON','SINGLE_FACT','STEPS','OPTIONS','NEWS','NARRATIVE']},
              decision:{type:'string',enum:['EMIT','MERGE','SKIP']},
              mergeInto:{type:'integer',description:'Index of EMIT target for MERGE; -1 otherwise'},reason:text
            },required:['goalRef','questionKey','scope','period','shape','decision','mergeInto','reason'],additionalProperties:false}}
          },required:['batchId','audienceKey','items'],additionalProperties:false
        }} : {}),
      },
      required: ['candidates', 'selectedIndex', ...(editorialRequired ? ['editorialPlan'] : [])],
      additionalProperties: false,
    },
    async execute(args, signal) {
      if (
        !isRecord(args) ||
        !Array.isArray(args.candidates) ||
        args.candidates.length < 1 ||
        args.candidates.length > 10 ||
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
      if (editorialRequired && (!isRecord(args.editorialPlan) || !Array.isArray(args.editorialPlan.items) || args.editorialPlan.items.length !== args.candidates.length)) throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
      const chosen = args.candidates[Number(args.selectedIndex)];
      if (requestedType && isRecord(chosen) && chosen.businessType !== requestedType)
        throw new RuntimeError('BRIEFING_TYPE_MISMATCH');
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
