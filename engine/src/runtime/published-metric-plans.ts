import { isRecord } from './http-json.js';
import { RuntimeError } from './ports.js';

/** Attempt-local plans, populated only from the validated platform context response. */
export function publishedMetricPlans() {
  const plans = new Map<string, Record<string, unknown>>();
  const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
  const key = (v: Record<string, unknown>) => [v.metricId, v.metricVersion, v.datasetId, v.snapshotId].join(':');
  return {
    record(response: unknown) {
      if (!isRecord(response) || !['dataset_search','dataset_read'].includes(String(response.action)) || !isRecord(response.result)) return;
      const sources = response.action === 'dataset_search' ? response.result.items : [response.result.source];
      if (!Array.isArray(sources)) return;
      for (const source of sources) {
        if (!isRecord(source) || !uuid(source.datasetId) || !uuid(source.snapshotId) || !isRecord(source.governedMetrics) || !Array.isArray(source.governedMetrics.items)) continue;
        for (const metric of source.governedMetrics.items) {
          if (!isRecord(metric) || !uuid(metric.metricId) || !Number.isInteger(metric.version) || Number(metric.version)<1 || !isRecord(metric.executionRequest)) continue;
          const plan=metric.executionRequest;
          if (plan.metricId!==metric.metricId || plan.metricVersion!==metric.version || plan.datasetId!==source.datasetId || plan.snapshotId!==source.snapshotId) throw new RuntimeError('INVALID_CONTEXT_RESPONSE');
          if (plans.size>=64 && !plans.has(key(plan))) throw new RuntimeError('METRIC_PLAN_LIMIT');
          plans.set(key(plan),structuredClone(plan));
        }
      }
    },
    resolve(selection: Record<string, unknown>) {
      const plan=plans.get(key(selection));
      if (!plan) throw new RuntimeError('METRIC_DEFINITION_REQUIRED','先用 task_context 检索该数据集已发布指标，再提交其 metricId、metricVersion、datasetId、snapshotId。没有适用指标时停止该数值选题。');
      // Selection never edits a published scope. The API rechecks publication, ACL and snapshot pins.
      return structuredClone(plan);
    },
  };
}
