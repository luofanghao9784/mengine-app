import { isRecord } from './http-json.js';
import { RuntimeError, type Json, type TaskTool } from './ports.js';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const decimal = (v: unknown) =>
  v === null || (typeof v === 'string' && /^-?\d{1,64}(?:\.\d{1,12})?$/.test(v));
const row = (v: unknown) =>
  isRecord(v) &&
  ['baseline', 'current', 'difference', 'changePercent'].every((k) => decimal(v[k])) &&
  ['baselineRank', 'currentRank'].every(
    (k) => v[k] === null || (Number.isInteger(v[k]) && Number(v[k]) >= 1 && Number(v[k]) <= 50),
  ) &&
  [null, 'MISSING_PERIOD', 'NON_POSITIVE_BASELINE', 'UNEQUAL_GROUP_COVERAGE'].includes(
    v.issue as string | null,
  );
export function datasetComparisonTool(options: {
  authorize(): Promise<void>;
  invoke(body: unknown, signal: AbortSignal): Promise<unknown>;
}): TaskTool {
  return {
    name: 'compare_dataset',
    description:
      'Compute a deterministic two-period grouped sum (aggregation SUM, default) or row count (aggregation COUNT, omit valueColumn), difference, change percent and descending competition rank over ALL rows in one pinned collected dataset snapshot. First use task_context dataset_search to obtain authorized datasetId, snapshotId and exact column names; use dataset_read for period values and follow column pages if needed. Parameters use exact header names (not Excel letters) and exact period text. For date columns use periodMode=MONTH and baseline/current YYYY-MM, with an explicit IANA business timeZone (defaults Asia/Shanghai). Dates are grouped into months over ALL rows; missing/ambiguous dates fail closed. Do not invent a month column. A sample page is never a total. For member lists or lesson records without a numeric measure, use COUNT to count actual rows; this is not distinct people or monetary sum. Missing or ambiguous numeric values in SUM fail rather than become zero; missing periods and non-positive baselines are explicit gaps. All rows outside the selected two periods are counted as ignored. Result artifact.id can be used with deliver_briefing for a DATA card. Null coverageThrough means unknown business coverage, collectedAt is only collection time. No raw SQL, model-supplied rows, arbitrary formulas, permissions, writes or publishing.',
    parameters: {
      type: 'object',
      properties: {
        aggregation: { type: 'string', enum: ['SUM', 'COUNT'] },
        periodMode: { type: 'string', enum: ['EXACT', 'MONTH'] },
        timeZone: { type: 'string', description: 'IANA business timezone; defaults to Asia/Shanghai' },
        ...Object.fromEntries(
          [
            'datasetId',
            'snapshotId',
            'groupColumn',
            'periodColumn',
            'valueColumn',
            'baseline',
            'current',
          ].map((k) => [k, { type: 'string' }]),
        ),
      },
      required: [
        'datasetId',
        'snapshotId',
        'groupColumn',
        'periodColumn',
        'baseline',
        'current',
      ],
      additionalProperties: false,
    },
    async execute(args, signal) {
      if (
        !isRecord(args) ||
        !uuid(args.datasetId) ||
        !uuid(args.snapshotId) ||
        (args.aggregation === 'COUNT' ? ['groupColumn','periodColumn'] : ['groupColumn', 'periodColumn', 'valueColumn']).some(
          (k) => typeof args[k] !== 'string' || !args[k] || (args[k] as string).length > 160,
        ) ||
        ['baseline', 'current'].some(
          (k) =>
            typeof args[k] !== 'string' || !(args[k] as string).trim() || (args[k] as string).length > 100,
        ) ||
        (args.aggregation !== undefined && !['SUM','COUNT'].includes(String(args.aggregation))) ||
        (args.periodMode !== undefined && !['EXACT', 'MONTH'].includes(String(args.periodMode))) ||
        (args.timeZone !== undefined && (typeof args.timeZone !== 'string' || args.timeZone.length > 80)) ||
        args.baseline === args.current
      )
        throw new RuntimeError('INVALID_TOOL_ARGUMENTS');
      await options.authorize();
      const r = await options.invoke(args, signal);
      await options.authorize();
      if (
        !isRecord(r) ||
        r.contractVersion !== '1.0' ||
        r.status !== 'COMPUTED' ||
        !isRecord(r.datasetSource) ||
        !isRecord(r.calculation) ||
        !isRecord(r.artifact)
      )
        throw new RuntimeError('DATASET_RESULT_INVALID');
      const s = r.datasetSource,
        c = r.calculation,
        a = r.artifact;
      if (
        s.datasetId !== args.datasetId ||
        s.snapshotId !== args.snapshotId ||
        !Number.isInteger(s.version) ||
        Number(s.version) < 1 ||
        typeof s.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(s.sha256) ||
        !Number.isInteger(s.rowCount) ||
        Number(s.rowCount) < 0 ||
        Number(s.rowCount) > 100000 ||
        typeof s.name !== 'string' ||
        !s.name ||
        s.name.length > 160 ||
        typeof s.collectedAt !== 'string' ||
        !Number.isFinite(Date.parse(s.collectedAt)) ||
        !(
          s.coverageThrough === null ||
          (typeof s.coverageThrough === 'string' && Number.isFinite(Date.parse(s.coverageThrough)))
        ) ||
        !['dataset-compare-1', 'dataset-compare-month-1'].includes(String(c.recipeVersion)) ||
        c.status !== 'COMPUTED' ||
        c.inputSha256 !== s.sha256 ||
        !isRecord(c.request) ||
        Object.keys(args).some((k) => (c.request as Record<string, unknown>)[k] !== args[k]) ||
        !Number.isInteger(c.matchedRows) ||
        Number(c.matchedRows) < 1 ||
        !Number.isInteger(c.ignoredRows) ||
        Number(c.ignoredRows) < 0 ||
        Number(c.matchedRows) + Number(c.ignoredRows) !== s.rowCount ||
        !Array.isArray(c.rows) ||
        !c.rows.length ||
        c.rows.length > 50 ||
        !c.rows.every(
          (v) => row(v) && typeof v.group === 'string' && v.group.length > 0 && v.group.length <= 100,
        ) ||
        !row(c.totals) ||
        (c.totals as Record<string, unknown>).group !== null ||
        !uuid(a.id) ||
        typeof a.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(a.sha256) ||
        a.filename !== `dataset-comparison-${a.sha256.slice(0, 20)}.json`
      )
        throw new RuntimeError('DATASET_RESULT_INVALID');
      return r as Json;
    },
  };
}
