import { createHash } from 'node:crypto';
import { RuntimeError, type Json, type TaskTool } from './ports.js';
import type { TaskSandbox } from './sandbox.js';
import type { OriginalInputs } from './original-inputs.js';
import { isRecord } from './http-json.js';
import { summaryWorkbook, type CsvSummary } from './summary-workbook.js';

export const recipeVersion = '1.1.0';
const failures = new Set(['UNSUPPORTED', 'ENCODING', 'INVALID', 'LIMIT', 'DATA']);

/** Self-contained, release-owned computation copied into the existing offline task sandbox. */
export function computeRecipe(text: string, name: string, options: Record<string, unknown>) {
  const fail = (code: string): never => {
    throw new Error(code);
  };
  const exactKeys = (value: Record<string, unknown>, keys: string[]) => {
    if (Object.keys(value).some((key) => !keys.includes(key))) fail('INVALID');
  };
  if (name === 'text_extract') {
    exactKeys(options, ['lineStart', 'lineEnd']);
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    if (lines.at(-1) === '' && lines.length > 1) lines.pop();
    const start = options.lineStart ?? 1,
      end = options.lineEnd ?? lines.length;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      Number(start) < 1 ||
      Number(end) < Number(start) ||
      Number(end) > lines.length
    )
      fail('INVALID');
    const body = lines.slice(Number(start) - 1, Number(end)).join('\n');
    if (Buffer.byteLength(body) > 32000) fail('LIMIT');
    return {
      filename: 'extracted.txt',
      body,
      summary: {
        totalLines: lines.length,
        lineStart: start,
        lineEnd: end,
        selectedLines: Number(end) - Number(start) + 1,
      },
    };
  }
  if (name !== 'csv_summary') fail('UNSUPPORTED');
  exactKeys(options, [
    'operation',
    'column',
    'groupBy',
    'filterColumn',
    'filterValue',
    'blankNumbers',
    'delimiter',
  ]);
  const operation = options.operation ?? 'count',
    delimiter = options.delimiter ?? ',';
  if (
    !['count', 'sum'].includes(String(operation)) ||
    ![',', '\t', ';'].includes(String(delimiter)) ||
    !['reject', 'skip'].includes(String(options.blankNumbers ?? 'reject'))
  )
    fail('INVALID');
  // Strict CSV state machine: quoted delimiters/newlines and escaped quotes are data.
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const cell = () => {
    row.push(field);
    field = '';
    closed = false;
    if (row.length > 200) fail('LIMIT');
  };
  const record = () => {
    cell();
    rows.push(row);
    row = [];
    if (rows.length > 20001) fail('LIMIT');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === delimiter) cell();
    else if (c === '\n' || c === '\r') {
      record();
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else if (c === '"') {
      if (field || closed) fail('DATA');
      quoted = true;
    } else {
      if (closed) fail('DATA');
      field += c;
    }
    if (field.length > 32768) fail('LIMIT');
  }
  if (quoted) fail('DATA');
  if (field || row.length || closed) record();
  if (!rows.length) fail('DATA');
  const headers = rows.shift()!;
  if (headers.some((h) => !h.trim() || h.length > 180) || new Set(headers).size !== headers.length)
    fail('DATA');
  if (rows.some((r) => r.length !== headers.length)) fail('DATA');
  const index = (key: string, required: boolean) => {
    const value = options[key];
    if (value === undefined && !required) return -1;
    if (typeof value !== 'string' || !headers.includes(value)) fail('INVALID');
    return headers.indexOf(value as string);
  };
  const column = index('column', operation === 'sum'),
    group = index('groupBy', false),
    filter = index('filterColumn', false);
  if (
    filter >= 0 !== (typeof options.filterValue === 'string') ||
    (typeof options.filterValue === 'string' && options.filterValue.length > 32768)
  )
    fail('INVALID');
  const decimal = (raw: string) => {
    // No locale, currency, percentages, exponent or formula interpretation.
    if (!/^-?(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,12})?$/.test(raw)) fail('DATA');
    const [whole, fraction = ''] = raw.split('.');
    return BigInt(whole + fraction.padEnd(12, '0'));
  };
  const display = (value: bigint) => {
    const negative = value < 0n,
      digits = (negative ? -value : value).toString().padStart(13, '0');
    const fraction = digits.slice(-12).replace(/0+$/, '');
    return (negative ? '-' : '') + digits.slice(0, -12) + (fraction ? '.' + fraction : '');
  };
  const groups = new Map<
    string,
    { key: string | null; rows: number; numericRows: number; skippedBlankNumbers: number; total: bigint }
  >();
  let matchedRows = 0,
    skipped = 0,
    total = 0n,
    numericRows = 0;
  for (const values of rows) {
    if (filter >= 0 && values[filter] !== options.filterValue) continue;
    matchedRows++;
    const key = group >= 0 ? values[group] : '';
    if (key.length > 1000) fail('LIMIT');
    if (!groups.has(key)) {
      if (groups.size >= 100) fail('LIMIT');
      groups.set(key, {
        key: group >= 0 ? key : null,
        rows: 0,
        numericRows: 0,
        skippedBlankNumbers: 0,
        total: 0n,
      });
    }
    const result = groups.get(key)!;
    result.rows++;
    if (operation === 'sum') {
      const value = values[column];
      if (value === '' && options.blankNumbers === 'skip') {
        skipped++;
        result.skippedBlankNumbers++;
        continue;
      }
      const number = decimal(value);
      total += number;
      result.total += number;
      numericRows++;
      result.numericRows++;
    }
  }
  const summary: CsvSummary = {
    headers,
    totalRows: rows.length,
    matchedRows,
    operation: operation as 'count' | 'sum',
    numericRows,
    skippedBlankNumbers: skipped,
    total: operation === 'sum' ? display(total) : null,
    groups: [...groups.values()].map(({ total: sum, ...g }) => ({
      ...g,
      total: operation === 'sum' ? display(sum) : null,
    })),
  };
  const body = JSON.stringify(summary, null, 2);
  if (Buffer.byteLength(body) > 12000) fail('LIMIT');
  return { filename: 'summary.json', body, summary };
}

export function originalRecipeTool(config: {
  originals: OriginalInputs;
  sandbox: TaskSandbox;
  authorize(): Promise<void>;
  enabled(): boolean;
  failed(code: string): void;
}): TaskTool {
  let invocation = 0;
  return {
    name: 'process_original',
    description:
      'Use an activated file-processing recipe on one already loaded original. csv_summary: strict UTF-8 CSV count or exact decimal sum, optional groupBy and exact string filterColumn/filterValue; text_extract: UTF-8 TXT/Markdown line range. CSV summaries also produce a private XLSX snapshot with source and calculation rules. No workbook input, formulas, macros, automatic numeric coercion or business writes. Outputs private result and versioned provenance files.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        versionId: { type: 'string' },
        recipe: { type: 'string', enum: ['csv_summary', 'text_extract'] },
        options: {
          type: 'object',
          additionalProperties: false,
          properties: {
            operation: { type: 'string', enum: ['count', 'sum'] },
            column: { type: 'string' },
            groupBy: { type: 'string' },
            filterColumn: { type: 'string' },
            filterValue: { type: 'string' },
            blankNumbers: { type: 'string', enum: ['reject', 'skip'] },
            delimiter: { type: 'string', enum: [',', '\t', ';'] },
            lineStart: { type: 'integer' },
            lineEnd: { type: 'integer' },
          },
        },
      },
      required: ['versionId', 'recipe', 'options'],
    },
    modelOutput(value) {
      if (!isRecord(value) || !Array.isArray(value.artifacts))
        throw new RuntimeError('INVALID_RECIPE_RESULT');
      if (value.recipe !== 'csv_summary') return value;
      return {
        ...value,
        artifacts: value.artifacts.map((file) => {
          if (!isRecord(file) || typeof file.contentBase64 !== 'string')
            throw new RuntimeError('INVALID_RECIPE_RESULT');
          return {
            name: file.name,
            sha256: file.sha256,
            bytes: Buffer.from(file.contentBase64, 'base64').length,
          };
        }),
      } as Json;
    },
    async execute(args, signal) {
      await config.authorize();
      if (!config.enabled()) throw new RuntimeError('SKILL_NOT_ACTIVE');
      const { versionId, recipe, options } = args as {
        versionId: string;
        recipe: string;
        options: Record<string, unknown>;
      };
      const original = config.originals.loadedOriginal(versionId);
      if (!original) throw new RuntimeError('INPUT_NOT_GRANTED');
      const error = (code: string): never => {
        config.failed('TASK_FILE_' + code);
        throw new RuntimeError('TASK_FILE_' + code);
      };
      if (!isRecord(options) || Buffer.byteLength(JSON.stringify(options)) > 2048) error('INVALID');
      if (
        !(recipe === 'csv_summary' ? /\.(csv|tsv)$/i : /\.(txt|md|markdown)$/i).test(
          original.metadata.filename,
        )
      )
        error('UNSUPPORTED');
      const number = ++invocation;
      const outputName =
        recipe === 'csv_summary' ? `table-summary-${number}.json` : `extracted-${number}.txt`;
      const reportName = `processing-report-${number}.json`;
      const workbookName = recipe === 'csv_summary' ? `table-summary-${number}.xlsx` : null;
      const provenance = {
        recipe,
        recipeVersion,
        materialId: original.metadata.materialId,
        versionId,
        filename: original.metadata.filename,
        version: original.metadata.version,
        inputSha256: original.metadata.sha256,
        inputBytes: original.metadata.bytes,
        invocation: number,
        options,
      };
      const script = `import fs from 'node:fs';import {createHash} from 'node:crypto';import {deflateRawSync} from 'node:zlib';\nimport {computeRecipe as compute,summaryWorkbook} from './inputs/recipe-runtime.mjs';
        try {
          const bytes = fs.readFileSync('../inputs/' + ${JSON.stringify(original.file.handle)});
          let text; try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); } catch { throw new Error('ENCODING'); }
          const result = compute(text, ${JSON.stringify(recipe)}, ${JSON.stringify(options)});
          const workbookName = ${JSON.stringify(workbookName)};
          const workbook = workbookName ? summaryWorkbook(result.summary, ${JSON.stringify(provenance)}, deflateRawSync) : null;
          fs.writeFileSync(${JSON.stringify(outputName)}, result.body);
          if (workbook) fs.writeFileSync(workbookName, workbook);
          const output = {filename:${JSON.stringify(outputName)}, bytes:Buffer.byteLength(result.body), sha256:createHash('sha256').update(result.body).digest('hex')};
          fs.writeFileSync(${JSON.stringify(reportName)}, JSON.stringify({ ...${JSON.stringify(provenance)}, output, ...(workbook ? {workbook:{filename:workbookName, bytes:workbook.length, sha256:createHash('sha256').update(workbook).digest('hex')}} : {}), summary: result.summary }, null, 2));
          console.log(JSON.stringify({status:'ok', summary:result.summary}));
        } catch (error) { console.log(JSON.stringify({status:'error', code:error.message})); }
      `;
      const runtime = {
        handle: 'recipe-runtime.mjs',
        bytes: Buffer.from(
          `export const computeRecipe = ${computeRecipe.toString()};\nexport const summaryWorkbook = ${summaryWorkbook.toString()};`,
        ),
      };
      const result = await config.sandbox.run(script, [original.file, runtime], signal);
      await config.authorize();
      let message: unknown;
      try {
        message = JSON.parse(result.stdout);
      } catch {
        throw new RuntimeError('INVALID_RECIPE_RESULT');
      }
      if (!isRecord(message)) throw new RuntimeError('INVALID_RECIPE_RESULT');
      if (message.status === 'error')
        error(typeof message.code === 'string' && failures.has(message.code) ? message.code : 'DATA');
      const expected = new Set([outputName, reportName, ...(workbookName ? [workbookName] : [])]);
      if (
        message.status !== 'ok' ||
        result.artifacts.length !== (workbookName ? 3 : 2) ||
        result.artifacts.some((f) => !expected.delete(f.name)) ||
        expected.size
      )
        throw new RuntimeError('INVALID_RECIPE_RESULT');
      const response = {
        recipe,
        recipeVersion,
        versionId,
        summary: message.summary as Json,
        artifacts: result.artifacts.map((f) => ({
          name: f.name,
          sha256: createHash('sha256').update(f.bytes).digest('hex'),
          contentBase64: Buffer.from(f.bytes).toString('base64'),
        })),
      };
      if (Buffer.byteLength(JSON.stringify(response)) > 65536) error('LIMIT');
      return response;
    },
  };
}
