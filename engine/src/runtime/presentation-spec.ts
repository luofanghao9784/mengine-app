import { RuntimeError } from './ports.js';
import { isRecord } from './http-json.js';
export type DeckSlide = {
  kind: 'cover' | 'bullets' | 'table' | 'chart';
  title: string;
  sourceIds: string[];
  subtitle?: string;
  bullets?: string[];
  headers?: string[];
  rows?: string[][];
  labels?: string[];
  values?: number[];
  series?: string;
  unit?: string;
};
export type DeckSpec = { title: string; theme: 'ocean' | 'ink'; slides: DeckSlide[] };
const text = (max: number) => ({
  type: 'string',
  minLength: 1,
  maxLength: max,
  pattern: /^[^\u0000-\u001f\u007f]+$/.source,
});
export const presentationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'theme', 'slides'],
  properties: {
    title: text(48),
    theme: { type: 'string', enum: ['ocean', 'ink'] },
    slides: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'sourceIds'],
        properties: {
          kind: { type: 'string', enum: ['cover', 'bullets', 'table', 'chart'] },
          title: text(40),
          sourceIds: {
            type: 'array',
            maxItems: 10,
            uniqueItems: true,
            items: { type: 'string', format: 'uuid' },
          },
          subtitle: text(100),
          bullets: { type: 'array', minItems: 1, maxItems: 4, items: text(90) },
          headers: { type: 'array', minItems: 2, maxItems: 5, items: text(16) },
          rows: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: { type: 'array', minItems: 2, maxItems: 5, items: text(24) },
          },
          labels: { type: 'array', minItems: 2, maxItems: 8, items: text(12) },
          values: {
            type: 'array',
            minItems: 2,
            maxItems: 8,
            items: { type: 'number', minimum: 0, maximum: 1e12 },
          },
          series: text(24),
          unit: text(12),
        },
      },
    },
  },
};
const validText = (v: unknown, max: number): v is string =>
  typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const uuid = (v: unknown) =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const strings = (v: unknown, min: number, max: number, len: number): v is string[] =>
  Array.isArray(v) && v.length >= min && v.length <= max && v.every((x) => validText(x, len));
/** Closed data contract: no executable code, external URLs, raw XML, file paths or style objects. */
export function parseDeck(value: unknown): DeckSpec {
  const bad = () => {
    throw new RuntimeError('INVALID_PRESENTATION');
  };
  if (
    !isRecord(value) ||
    Object.keys(value).some((k) => !['title', 'theme', 'slides'].includes(k)) ||
    !validText(value.title, 48) ||
    !['ocean', 'ink'].includes(String(value.theme)) ||
    !Array.isArray(value.slides) ||
    !value.slides.length ||
    value.slides.length > 8
  )
    return bad();
  const fields: Record<string, string[]> = {
    cover: ['subtitle'],
    bullets: ['bullets'],
    table: ['headers', 'rows'],
    chart: ['labels', 'values', 'series', 'unit'],
  };
  for (const s of value.slides) {
    if (
      !isRecord(s) ||
      typeof s.kind !== 'string' ||
      !Object.hasOwn(fields, s.kind) ||
      !validText(s.title, 40) ||
      !Array.isArray(s.sourceIds) ||
      s.sourceIds.length > 10 ||
      new Set(s.sourceIds).size !== s.sourceIds.length ||
      !s.sourceIds.every(uuid)
    )
      return bad();
    if (Object.keys(s).some((k) => !['kind', 'title', 'sourceIds', ...fields[s.kind as string]].includes(k)))
      return bad();
    if (s.kind === 'cover' && s.subtitle !== undefined && !validText(s.subtitle, 100)) return bad();
    if (s.kind === 'bullets' && !strings(s.bullets, 1, 4, 90)) return bad();
    if (
      s.kind === 'table' &&
      (!strings(s.headers, 2, 5, 16) ||
        !Array.isArray(s.rows) ||
        !s.rows.length ||
        s.rows.length > 6 ||
        s.rows.some((r) => !strings(r, 2, 5, 24) || r.length !== (s.headers as unknown[]).length))
    )
      return bad();
    if (
      s.kind === 'chart' &&
      (!strings(s.labels, 2, 8, 12) ||
        !Array.isArray(s.values) ||
        s.values.length !== s.labels.length ||
        s.values.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e12) ||
        !validText(s.series, 24) ||
        !validText(s.unit, 12))
    )
      return bad();
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 16384) return bad();
  return structuredClone(value) as unknown as DeckSpec;
}
// Harness supports a structural subset. Limits remain enforced by parseDeck before worker dispatch.
export const presentationToolSchema = JSON.parse(
  JSON.stringify(presentationSchema, (key, value) =>
    [
      'minLength',
      'maxLength',
      'pattern',
      'minItems',
      'maxItems',
      'uniqueItems',
      'format',
      'minimum',
      'maximum',
    ].includes(key)
      ? undefined
      : value,
  ),
) as Record<string, unknown>;
