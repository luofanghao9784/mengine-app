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
/** Check the platform's composition receipt with exact fixed-point integers, never JS floats. */
function validComposition(c: Record<string, unknown>): boolean {
  try {
    const scaled=(v: unknown) => {
      if(typeof v!=='string'||!/^\d{1,64}(?:\.\d{1,12})?$/.test(v))throw Error();
      const [whole,fraction='']=v.split('.');return BigInt(whole+fraction.padEnd(12,'0'));
    };
    const total=scaled(c.total), seen=new Set<string>();let sum=0n;
    for(const r of c.rows as Record<string, unknown>[]) {
      const value=scaled(r.value), key=JSON.stringify(r.group);
      if(seen.has(key))return false;seen.add(key);sum+=value;
      if(total===0n){if(r.sharePercent!=null)return false;}
      else {
        const rounded=(value*100000000n*2n+total)/(2n*total);
        if(scaled(r.sharePercent)!==rounded*1000000n)return false;
      }
    }
    return sum===total;
  }catch{return false;}
}
function argumentHint(args: unknown): string {
  if (!isRecord(args)) return 'Pass a JSON object with datasetId and snapshotId returned by dataset_search.';
  if (!uuid(args.datasetId) || !uuid(args.snapshotId)) return 'datasetId and snapshotId must be exact UUIDs returned by dataset_search; names and version numbers are not IDs.';
  if (['SUMMARY','COMPOSITION'].includes(String(args.operation))) {
    if (!Array.isArray(args.groupColumns) || args.groupColumns.length < 1 || args.groupColumns.length > 3)
      return 'SUMMARY requires groupColumns as an array of 1 to 3 exact headers, not groupColumn. A whole-scope total must still use a supported grouping.';
    if (['groupColumn','periodColumn','baseline','current','periodMode'].some(k=>args[k] !== undefined))
      return 'SUMMARY must OMIT groupColumn, periodColumn, baseline, current and periodMode entirely. Use groupColumns (array), one valueColumn for SUM or aggregation COUNT. Date filters use separate dateColumn/dateFrom/dateTo.';
    if (args.aggregation !== 'COUNT' && (typeof args.valueColumn !== 'string' || !args.valueColumn.trim()))
      return 'SUM requires exactly one numeric valueColumn header. COUNT counts rows and does not require a valueColumn.';
  } else if (args.groupColumns !== undefined) return 'COMPARE uses singular groupColumn and periodColumn plus distinct baseline/current. For grouped totals use operation SUMMARY and groupColumns; never mix the two forms.';
  if ((args.dateFrom !== undefined || args.dateTo !== undefined) !== (args.dateColumn !== undefined))
    return 'A dateColumn requires at least one YYYY-MM-DD dateFrom/dateTo boundary; boundaries require dateColumn. Omit all three for the whole snapshot.';
  return 'Use only exact headers and returned IDs. SUMMARY: groupColumns array (1..3 distinct headers), one valueColumn for SUM or aggregation COUNT, no comparison fields. COMPARE: groupColumn, periodColumn, two distinct nonempty baseline/current strings, one valueColumn for SUM or aggregation COUNT. Omit unused optional fields; dates must be YYYY-MM-DD.';
}
/** Remove only absent optional values; never repair IDs, headers, periods or business filters. */
export function normalizeDatasetArguments(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const copy = { ...value };
  for (const key of ['operation','aggregation','periodMode','timeZone','groupColumn','periodColumn','valueColumn','baseline','current','groupColumns','dateColumn','dateFrom','dateTo','missingDates'])
    if (copy[key] === null) delete copy[key];
  return copy;
}
export function datasetComparisonTool(options: {
  allowSummary?: boolean;
  allowComposition?: boolean;
  onVerified?(receipt: Record<string, unknown>): void;
  allowDateRange?: boolean;
  authorize(): Promise<void>;
  invoke(body: unknown, signal: AbortSignal): Promise<unknown>;
}): TaskTool {
  return {
    name: 'compare_dataset',
    normalizeArguments: normalizeDatasetArguments,
    description: options.allowDateRange === false ? 'Compute only a deterministic two-period SUM or COUNT over all pinned snapshot rows. Use groupColumn, periodColumn, baseline/current and optional periodMode=MONTH for any actual date column with YYYY-MM periods. The backend has not advertised date-range summaries: do not accept cumulative range requests as unfiltered full-history totals. Search exact dataset/snapshot IDs and headers first; never compute totals from sample pages.' :
      'Calculate over ALL rows in an authorized pinned database snapshot; never total sample pages. Choose exactly one request shape. SUMMARY (only when operation enum includes it): {operation:"SUMMARY",datasetId:<returned UUID>,snapshotId:<returned UUID>,groupColumns:[<exact category header>],aggregation:"SUM",valueColumn:<exact numeric header>}. SUMMARY must OMIT groupColumn, periodColumn, baseline, current and periodMode. COMPARE: {operation:"COMPARE",datasetId:<returned UUID>,snapshotId:<returned UUID>,groupColumn:<exact category header>,periodColumn:<exact period/date header>,baseline:<first period>,current:<second distinct period>,aggregation:"SUM",valueColumn:<exact numeric header>}. COMPARE must OMIT groupColumns. COUNT counts records: omit valueColumn. For dates in COMPARE use periodMode:"MONTH" with YYYY-MM periods and timeZone:"Asia/Shanghai". For a user-specified date filter in either shape, add dateColumn and at least one inclusive YYYY-MM-DD dateFrom/dateTo. Otherwise OMIT ALL date fields, including dateColumn and missingDates. Do not send null optional fields. Missing dates default to failure; missingDates:"EXCLUDE" explicitly excludes blank dates and requires disclosure. Search IDs/headers with task_context dataset_search; read only missing column pages/category values, then calculate. Unknown coverageThrough is not collection-time business coverage. Exact decimal results retain the original column unit: *_cents is 分, not 元; *_grams is 克. Never turn raw cents into yuan without dividing by 100 and clearly disclosing conversion. Do not combine different monetary measures or count records as distinct people. Use artifact.id for a DATA card. SUMMARY supports CURRENT_BAR or TABLE; no baseline or change percentage. No SQL, model-provided rows, formulas, writes or publication.' + (options.allowComposition ? ' COMPOSITION uses the SUMMARY shape with exactly one category groupColumns entry. Use it for shares within one scope, never compare two statuses as periods. All measures must be nonnegative. Platform computes total and sharePercent (6 decimal places; rounded shares may not sum to exactly 100). A zero total has null shares and cannot form a data card. Never submit shares or a denominator.' : '') ,
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: [...(options.allowSummary === false ? ['COMPARE'] : ['COMPARE','SUMMARY']), ...(options.allowComposition ? ['COMPOSITION'] : [])] },
        ...(options.allowDateRange === false ? {} : {
        groupColumns: { type: 'array', items: { type: 'string' }, description: 'SUMMARY only: 1..3 distinct exact column names.' },
        dateColumn: { type: 'string' },
        dateFrom: { type: 'string', description: 'Inclusive business date YYYY-MM-DD.' },
        dateTo: { type: 'string', description: 'Inclusive business date YYYY-MM-DD; omit for all later snapshot records.' },
        missingDates: { type: 'string', enum: ['FAIL','EXCLUDE'] },
        }),
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
          ].map((k) => [k, { type: 'string', description: ({datasetId:'Exact dataset UUID returned by dataset_search.',snapshotId:'Exact snapshot UUID returned by dataset_search; never a version number.',groupColumn:'COMPARE only. Omit for SUMMARY.',periodColumn:'COMPARE only. Omit for SUMMARY; date filters use dateColumn.',valueColumn:'One exact numeric header for SUM; omit for COUNT.',baseline:'COMPARE only: first exact period; omit for SUMMARY.',current:'COMPARE only: second distinct period; omit for SUMMARY.'} as Record<string,string>)[k] }]),
        ),
      },
      required: ['datasetId','snapshotId'],
      additionalProperties: false,
    },
    async execute(args, signal) {
      if (
        !isRecord(args) ||
        (options.allowSummary === false && args.operation === 'SUMMARY') ||
        (options.allowDateRange === false && ['groupColumns','dateColumn','dateFrom','dateTo','missingDates'].some(k=>args[k] !== undefined)) ||
        (args.operation === 'COMPOSITION' && (!options.allowComposition || !Array.isArray(args.groupColumns) || args.groupColumns.length !== 1)) ||
        !uuid(args.datasetId) ||
        !uuid(args.snapshotId) ||
        (['SUMMARY','COMPOSITION'].includes(String(args.operation))
          ? !Array.isArray(args.groupColumns) || args.groupColumns.length < 1 || args.groupColumns.length > 3 || new Set(args.groupColumns).size !== args.groupColumns.length || args.groupColumns.some(k => typeof k !== 'string' || !k.trim() || k.length > 160) || (args.aggregation !== 'COUNT' && (typeof args.valueColumn !== 'string' || !args.valueColumn.trim() || args.valueColumn.length > 160)) || ['groupColumn','periodColumn','baseline','current','periodMode'].some(k => args[k] !== undefined)
          : (args.aggregation === 'COUNT' ? ['groupColumn','periodColumn'] : ['groupColumn','periodColumn','valueColumn']).some(k => typeof args[k] !== 'string' || !(args[k] as string).trim() || (args[k] as string).length > 160) || ['baseline','current'].some(k => typeof args[k] !== 'string' || !(args[k] as string).trim() || (args[k] as string).length > 100) || args.baseline === args.current || args.groupColumns !== undefined) ||
        (args.operation !== undefined && !['COMPARE','SUMMARY','COMPOSITION'].includes(String(args.operation))) ||
        (args.missingDates !== undefined && !['FAIL','EXCLUDE'].includes(String(args.missingDates))) ||
        ((args.dateFrom !== undefined || args.dateTo !== undefined) !== (args.dateColumn !== undefined)) ||
        (args.dateColumn !== undefined && (typeof args.dateColumn !== 'string' || !args.dateColumn.trim() || args.dateColumn.length > 160)) ||
        ['dateFrom','dateTo'].some(k => args[k] !== undefined && (typeof args[k] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(args[k] as string))) ||
        (typeof args.dateFrom === 'string' && typeof args.dateTo === 'string' && args.dateFrom > args.dateTo) ||
        (args.aggregation !== undefined && !['SUM','COUNT'].includes(String(args.aggregation))) ||
        (args.periodMode !== undefined && !['EXACT', 'MONTH'].includes(String(args.periodMode))) ||
        (args.timeZone !== undefined && (typeof args.timeZone !== 'string' || args.timeZone.length > 80))
      )
        { const hint=argumentHint(args); console.warn(JSON.stringify({event:'DATASET_ARGUMENT_REJECTED',hint})); throw new RuntimeError('INVALID_TOOL_ARGUMENTS', hint); }
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
        !(['SUMMARY','COMPOSITION'].includes(String(args.operation)) ? [args.operation === 'COMPOSITION' ? 'dataset-composition-1' : 'dataset-summary-1'] : ['dataset-compare-1', 'dataset-compare-month-1']).includes(String(c.recipeVersion)) ||
        c.status !== 'COMPUTED' ||
        c.inputSha256 !== s.sha256 ||
        !isRecord(c.request) ||
        Object.keys(args).some((k) => JSON.stringify((c.request as Record<string, unknown>)[k]) !== JSON.stringify(args[k])) ||
        !Number.isInteger(c.matchedRows) ||
        Number(c.matchedRows) < 1 ||
        !Number.isInteger(c.ignoredRows) ||
        Number(c.ignoredRows) < 0 ||
        Number(c.matchedRows) + Number(c.ignoredRows) !== s.rowCount ||
        !Array.isArray(c.rows) ||
        !c.rows.length ||
        c.rows.length > 50 ||
        (['SUMMARY','COMPOSITION'].includes(String(args.operation))
          ? !c.rows.every(v => isRecord(v) && Array.isArray(v.group) && v.group.length === (args.groupColumns as unknown[]).length && v.group.every(k => typeof k === 'string' && k.length > 0 && k.length <= 100) && v.value !== null && decimal(v.value) && Number.isInteger(v.records) && Number(v.records) > 0) || !decimal(c.total) || c.total === null || !Number.isInteger(c.missingDateRows) || Number(c.missingDateRows) < 0 || Number(c.missingDateRows) > Number(c.ignoredRows) || c.rows.reduce((sum,v) => sum + Number((v as Record<string,unknown>).records),0) !== c.matchedRows
          : !c.rows.every(v => row(v) && typeof v.group === 'string' && v.group.length > 0 && v.group.length <= 100) || !row(c.totals) || (c.totals as Record<string,unknown>).group !== null) ||
        (args.operation === 'COMPOSITION' && !validComposition(c)) ||
        !uuid(a.id) ||
        typeof a.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(a.sha256) ||
        a.filename !== `dataset-comparison-${a.sha256.slice(0, 20)}.json`
      )
        throw new RuntimeError('DATASET_RESULT_INVALID');
      options.onVerified?.(r);
      return r as Json;
    },
  };
}
