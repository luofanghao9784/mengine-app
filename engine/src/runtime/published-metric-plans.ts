import { isRecord } from './http-json.js';
import { RuntimeError } from './ports.js';

/** Attempt-local plans, populated only from the validated platform context response. */
export function publishedMetricPlans() {
  const plans = new Map<string, Record<string, unknown>>();
  let fusionPrimary: Record<string,unknown> | undefined;
  const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
  const key = (v: Record<string, unknown>) => [v.metricId, v.metricVersion, v.datasetId, v.snapshotId].join(':');
  return {
    hasPlans: () => plans.size > 0,
    hasFusion: () => !!fusionPrimary,
    preferred(selection: Record<string,unknown>) {
      if(fusionPrimary)return {...fusionPrimary};
      const selected=plans.get(key(selection));
      if(!selected)throw new RuntimeError('METRIC_DEFINITION_REQUIRED');
      if(selected.operation!=='SUMMARY')return {...selection};
      const fields=['datasetId','snapshotId','operation','groupColumns','dateColumn','dateFrom','dateTo','timeZone','missingDates'];
      // Context order is assigned by the API: relevant, then not yet delivered to this actor.
      const first=[...plans.values()].find(p=>fields.every(k=>JSON.stringify(p[k]??null)===JSON.stringify(selected[k]??null)))!;
      return Object.fromEntries(['metricId','metricVersion','datasetId','snapshotId'].map(k=>[k,first[k]]));
    },
    companions(selection: Record<string, unknown>) {
      if(fusionPrimary)return [];
      const primary=plans.get(key(selection));
      if (!primary) throw new RuntimeError('METRIC_DEFINITION_REQUIRED');
      if (primary.operation !== 'SUMMARY') return [];
      const scope=['datasetId','snapshotId','operation','groupColumns','dateColumn','dateFrom','dateTo','timeZone','missingDates'];
      const grain=(p: Record<string,unknown>)=>JSON.stringify(scope.map(k=>p[k]??null));
      const measure=(p: Record<string,unknown>)=>JSON.stringify([p.aggregation??'SUM',p.valueColumn??null]);
      const seen=new Set([measure(primary)]), result: Record<string,unknown>[]=[];
      for (const p of plans.values()) {
        if (grain(p)!==grain(primary)||seen.has(measure(p))) continue;
        seen.add(measure(p));
        result.push(Object.fromEntries(['metricId','metricVersion','datasetId','snapshotId'].map(k=>[k,p[k]])));
        if(result.length===2)break;
      }
      return result;
    },
    record(response: unknown) {
      if (!isRecord(response) || !['dataset_search','dataset_read'].includes(String(response.action)) || !isRecord(response.result)) return;
      const fusion=response.result.fusionPlan;
      if(isRecord(fusion)){
        if(fusion.version!=='governed-star-v1'||!Array.isArray(fusion.metrics)||fusion.metrics.length!==2||!Array.isArray(fusion.sources)||fusion.sources.length!==3)throw new RuntimeError('INVALID_CONTEXT_RESPONSE');
        for(const metric of fusion.metrics){
          if(!isRecord(metric)||!uuid(metric.metricId)||!Number.isInteger(metric.version)||!isRecord(metric.executionRequest))throw new RuntimeError('INVALID_CONTEXT_RESPONSE');
          const plan=metric.executionRequest;
          if(plan.metricId!==metric.metricId||plan.metricVersion!==metric.version||!fusion.sources.some(s=>isRecord(s)&&s.datasetId===plan.datasetId&&s.snapshotId===plan.snapshotId))throw new RuntimeError('INVALID_CONTEXT_RESPONSE');
          plans.set(key(plan),structuredClone(plan));
          if(metric.metricId===fusion.primaryMetricId)fusionPrimary=Object.fromEntries(['metricId','metricVersion','datasetId','snapshotId'].map(k=>[k,plan[k]]));
        }
        if(!fusionPrimary)throw new RuntimeError('INVALID_CONTEXT_RESPONSE');
      }
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
