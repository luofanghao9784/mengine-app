import { isRecord } from './http-json.js';
import { RuntimeError, type Json, type TaskTool } from './ports.js';

/** Fixed platform recipe; receives only a source ID already granted by this attempt's search. */
export function tableComparisonTool(options: {
  hasSource(id: string): boolean;
  resolveSource?(id: string): string;
  invoke(body: unknown, signal: AbortSignal): Promise<unknown>;
  authorize(): Promise<void>;
}): TaskTool {
  return {
    name: 'compare_table',
    description:
      'Read a bounded range from the exact XLSX original version already granted by search_sources and calculate a two-period comparison. Use this tool for sums, changes and rankings instead of mental arithmetic. Use tableSourceId (e.g. table-1) from an XLSX search result as sourceId; a literal granted source id is also accepted; use its literal sheet name and cell coordinates. range includes exactly one header row then the data rows (e.g. A8:G18). Columns are Excel letters, not header names. baseline/current must match period cell text exactly. The fixed recipe sums by group+period, returns exact decimal strings, differences, change percentages, descending competition ranks and a private JSON calculation receipt. Missing numeric cells/formulas fail; missing periods and non-positive baselines yield explicit gaps. Scope is only the requested range, not proof of business completeness. No code execution, installation, charts, permissions or business writes.',
    parameters: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description:
            'tableSourceId such as table-1 from an XLSX search result; never invent a UUID or use material/version IDs.',
        },
        sheet: { type: 'string', description: 'Exact worksheet name, 1–31 characters.' },
        range: {
          type: 'string',
          description: 'Header-inclusive A1 range, e.g. A8:G18; at most 500 data rows and 20 columns.',
        },
        groupColumn: { type: 'string', description: 'Uppercase Excel column letters within the range.' },
        periodColumn: { type: 'string', description: 'Uppercase Excel column letters within the range.' },
        valueColumn: { type: 'string', description: 'Uppercase Excel column letters within the range.' },
        baseline: { type: 'string', description: 'Exact period cell text, 1–100 characters.' },
        current: { type: 'string', description: 'Exact period cell text, 1–100 characters.' },
      },
      required: [
        'sourceId',
        'sheet',
        'range',
        'groupColumn',
        'periodColumn',
        'valueColumn',
        'baseline',
        'current',
      ],
      additionalProperties: false,
    },
    async execute(args, signal) {
      if (!isRecord(args) || typeof args.sourceId !== 'string')
        throw new RuntimeError('TABLE_SOURCE_NOT_GRANTED');
      const sourceId = options.resolveSource?.(args.sourceId) ?? args.sourceId;
      if (!options.hasSource(sourceId)) throw new RuntimeError('TABLE_SOURCE_NOT_GRANTED');
      await options.authorize();
      const response = await options.invoke({ ...args, sourceId }, signal);
      await options.authorize();
      if (!isRecord(response) || response.contractVersion !== '1.0')
        throw new RuntimeError('TABLE_RESULT_INVALID');
      if (response.status === 'FAILED') {
        const code =
          typeof response.code === 'string' && /^[A-Z_]+(?::[A-Z]{1,2}[0-9]{1,5})?$/.test(response.code)
            ? response.code
            : 'TABLE_CALCULATOR_FAILED';
        throw new RuntimeError(code);
      }
      if (
        response.status !== 'COMPUTED' ||
        !isRecord(response.source) ||
        response.source.id !== sourceId ||
        !isRecord(response.calculation) ||
        response.calculation.recipeVersion !== 'table-compare-1' ||
        !Array.isArray(response.calculation.rows) ||
        response.calculation.rows.length < 1 ||
        response.calculation.rows.length > 50 ||
        !isRecord(response.artifact) ||
        typeof response.artifact.filename !== 'string' ||
        !/^table-comparison-[a-f0-9]{20}\.json$/.test(response.artifact.filename)
      )
        throw new RuntimeError('TABLE_RESULT_INVALID');
      return response as Json;
    },
  };
}
