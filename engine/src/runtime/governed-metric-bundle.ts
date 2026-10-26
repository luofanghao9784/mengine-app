import { isRecord } from './http-json.js';
import { RuntimeError, type Json, type TaskTool } from './ports.js';

/** One bounded selection of published plans; each calculation retains its own grain and receipt. */
export function governedMetricBundle(tool: TaskTool, enabled: boolean, resolve: (selection: Record<string, unknown>) => unknown, companions?: (selection: Record<string,unknown>) => Record<string,unknown>[], preferred?: (selection: Record<string,unknown>) => Record<string,unknown>, hasFusion?:()=>boolean): TaskTool {
  if (!enabled) return tool;
  const selection = {
    type: 'object', properties: { metricId: {type:'string'}, metricVersion: {type:'integer'}, datasetId: {type:'string'}, snapshotId: {type:'string'} },
    required: ['metricId','metricVersion','datasetId','snapshotId'], additionalProperties: false,
  };
  return {
    ...tool,
    description: tool.description + '\n若上下文包含 fusionPlan，平台强制执行该固定跨表计划：分别关联共同维度、汇总各事实表，在同一分组下对齐结果；不得改写或增加关联。返回 fusion 时必须同时解读至少两项相关指标。没有 fusionPlan 时才适用以下独立指标规则：可在 supportingMetrics 中选择最多两个相关已发布指标，与主指标组成同一主题的综合画报。未指定辅助指标时，平台优先将尚未交付的同口径候选用作主图，并自动补充同一快照、分组和日期口径下的不同指标；显式选择可以来自不同获权数据集；每个指标按自己的固定口径独立计算。优先选择互补业务指标，不必凑满。禁止将独立汇总视为逐行关联、拼接分母或混加不同粒度的金额。返回的主 artifact.id 用于交付，supportingCalculations 为正文提供附加已核验依据。',
    parameters: { ...tool.parameters, properties: { ...(tool.parameters as {properties: Record<string,unknown>}).properties, supportingMetrics: {type:'array', description:'最多两个相关已发布指标。', items:selection} } },
    async execute(args, signal) {
      if (!isRecord(args)) throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
      const {supportingMetrics, ...requested} = args;
      let primary=requested;
      if (supportingMetrics !== undefined && (!Array.isArray(supportingMetrics) || supportingMetrics.length > 2)) throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
      if (Object.keys(requested).length!==4 || Object.keys(requested).some(k=>!selection.required.includes(k))) throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
      resolve(requested);
      if ((hasFusion?.()||!Array.isArray(supportingMetrics)||supportingMetrics.length===0) && preferred) primary=preferred(requested);
      const selected = hasFusion?.() ? [] : Array.isArray(supportingMetrics) && supportingMetrics.length ? supportingMetrics : (companions?.(primary) ?? []);
      if (selected.length > 2) throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
      const selections = [primary, ...selected];
      const seen = new Set<string>();
      for (const item of selections) {
        if (!isRecord(item) || Object.keys(item).length !== 4 || Object.keys(item).some(k=>!selection.required.includes(k))) throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
        resolve(item); // Check every selection before dispatching any calculation.
        const key = String(item.metricId);
        if (seen.has(key)) throw new RuntimeError('DUPLICATE_METRIC_SELECTION');
        seen.add(key);
      }
      const receipts: Json[] = [];
      for (const item of selections) {
        signal.throwIfAborted();
        receipts.push(await tool.execute(item, signal));
      }
      if (!isRecord(receipts[0])) throw new RuntimeError('DATASET_RESULT_INVALID');
      if(isRecord(receipts[0].fusion))return {...receipts[0], requiredMetricMentions: Array.isArray(receipts[0].fusion.results) ? receipts[0].fusion.results.slice(0,2).map(r=>isRecord(r)?r.label:null) : [], analysisBoundary:'这是后端已固定并校验的跨表融合计划。fusion.results 为各事实表分别关联共同维度后汇总的完整结果，不是样本。请将 requiredMetricMentions 中的两项名称逐字复制到两段正文中，确保引用明确；不要在正文写 UUID、原始关联键、工具名称或 DATA 等内部标记。正文可以不重复数字，完整精确数值由表格交付。随后立即 deliver_briefing，不再检索或计算。必须在解读正文中分别写出至少两项相关结果的完整 label，结合共同维度讨论分布、差异与行动；表格与数值由后端交付，不需要 AI 重新汇总。保留每项单位、来源范围和未匹配记录，不编造转化率、因果或跨指标合计。使用现有主 artifact.id 调用 deliver_briefing。'} as Json;
      return { ...receipts[0], supportingCalculations: receipts.slice(1), analysisBoundary: '主图指标以本返回的 governedMetric 或 nativeAnalysisMethod 及主 artifact 为准，标题应与其一致。各指标独立计算，来源、期间、筛选与单位分别保留。只解读已计算事实；不能据此认定跨表逐行匹配、因果、转化率或收款完成率。交付主计算 artifact.id，正文注明各指标业务范围；不要把辅助指标数值误画到主图。' } as Json;
    },
  };
}
