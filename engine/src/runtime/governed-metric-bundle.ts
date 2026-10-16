import { isRecord } from './http-json.js';
import { RuntimeError, type Json, type TaskTool } from './ports.js';

/** One bounded selection of published plans; each calculation retains its own grain and receipt. */
export function governedMetricBundle(tool: TaskTool, enabled: boolean, resolve: (selection: Record<string, unknown>) => unknown, companions?: (selection: Record<string,unknown>) => Record<string,unknown>[]): TaskTool {
  if (!enabled) return tool;
  const selection = {
    type: 'object', properties: { metricId: {type:'string'}, metricVersion: {type:'integer'}, datasetId: {type:'string'}, snapshotId: {type:'string'} },
    required: ['metricId','metricVersion','datasetId','snapshotId'], additionalProperties: false,
  };
  return {
    ...tool,
    description: tool.description + '\n可在 supportingMetrics 中选择最多两个相关已发布指标，与主指标组成同一主题的综合画报。未指定辅助指标时，平台可自动补充同一快照、分组和日期口径下的不同指标；显式选择可以来自不同获权数据集；每个指标按自己的固定口径独立计算。优先选择互补业务指标，不必凑满。禁止将独立汇总视为逐行关联、拼接分母或混加不同粒度的金额。返回的主 artifact.id 用于交付，supportingCalculations 为正文提供附加已核验依据。',
    parameters: { ...tool.parameters, properties: { ...(tool.parameters as {properties: Record<string,unknown>}).properties, supportingMetrics: {type:'array', description:'最多两个相关已发布指标。', items:selection} } },
    async execute(args, signal) {
      if (!isRecord(args)) throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
      const {supportingMetrics, ...primary} = args;
      if (supportingMetrics !== undefined && (!Array.isArray(supportingMetrics) || supportingMetrics.length > 2)) throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
      const selected = Array.isArray(supportingMetrics) && supportingMetrics.length ? supportingMetrics : (companions?.(primary) ?? []);
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
      return { ...receipts[0], supportingCalculations: receipts.slice(1), analysisBoundary: '各指标独立计算，来源、期间、筛选与单位分别保留。只解读已计算事实；不能据此认定跨表逐行匹配、因果、转化率或收款完成率。交付主计算 artifact.id，正文注明各指标业务范围；不要把辅助指标数值误画到主图。' } as Json;
    },
  };
}
