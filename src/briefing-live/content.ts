import type { BriefingDocument, BriefingRow } from '../../contracts/public-api/briefing-content';
import { createIdentityRequest, record, uuid } from '../identity/client.ts';
const text = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const decimal = (v: unknown) =>
  v === null ||
  (typeof v === 'string' && /^-?\d{1,64}(?:\.\d{1,12})?$/.test(v) && Number.isFinite(Number(v)));
const rank = (v: unknown) => v === null || (Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 50);
const row = (v: unknown): v is BriefingRow =>
  record(v) &&
  (v.group === null || text(v.group, 1, 100)) &&
  ['baseline', 'current', 'difference', 'changePercent'].every((k) => decimal(v[k])) &&
  rank(v.baselineRank) &&
  rank(v.currentRank) &&
  (v.issue === null ||
    ['MISSING_PERIOD', 'NON_POSITIVE_BASELINE', 'UNEQUAL_GROUP_COVERAGE'].includes(String(v.issue)));
export function isBriefingDocument(v: unknown): v is BriefingDocument {
  if (!record(v) || !uuid(v.artifactId) || !hash(v.sha256) || !record(v.content)) return false;
  const c = v.content,
    ch = c.chart,
    s = c.source;
  if (c.schemaVersion === 'briefing-text-v1')
    return (
      ['INFO', 'INSIGHT', 'SUGGESTION', 'RESULT'].includes(String(c.businessType)) &&
      text(c.title, 4, 80) &&
      text(c.summary, 12, 240) &&
      Array.isArray(c.analysis) &&
      c.analysis.length >= 2 &&
      c.analysis.length <= 4 &&
      c.analysis.every((p) => text(p, 12, 500)) &&
      c.chart === null &&
      c.calculationArtifactId === null &&
      c.calculationSha256 === null &&
      (c.source === null ||
        (record(c.source) &&
          uuid(c.source.id) &&
          uuid(c.source.versionId) &&
          text(c.source.filename, 1, 255) &&
          text(c.source.scopeExcerpt, 1, 4000))) &&
      typeof c.generatedAt === 'string' &&
      Number.isFinite(Date.parse(c.generatedAt))
    );
  return (
    c.schemaVersion === 'briefing-data-v1' &&
    c.businessType === 'DATA' &&
    text(c.title, 4, 80) &&
    text(c.summary, 12, 240) &&
    Array.isArray(c.analysis) &&
    c.analysis.length >= 2 &&
    c.analysis.length <= 4 &&
    c.analysis.every((p) => text(p, 12, 500)) &&
    record(ch) &&
    ch.type === 'GROUPED_BAR' &&
    text(ch.metric, 1, 100) &&
    text(ch.unit, 1, 100) &&
    text(ch.baseline, 1, 100) &&
    text(ch.current, 1, 100) &&
    text(ch.range, 1, 32) &&
    Array.isArray(ch.rows) &&
    ch.rows.length > 0 &&
    ch.rows.length <= 50 &&
    ch.rows.every((r) => row(r) && r.group !== null) &&
    row(ch.totals) &&
    record(s) &&
    uuid(s.id) &&
    uuid(s.materialId) &&
    uuid(s.versionId) &&
    Number.isSafeInteger(s.version) &&
    Number(s.version) > 0 &&
    text(s.filename, 1, 255) &&
    hash(s.sha256) &&
    text(s.scopeExcerpt, 1, 4000) &&
    uuid(c.calculationArtifactId) &&
    hash(c.calculationSha256) &&
    typeof c.generatedAt === 'string' &&
    Number.isFinite(Date.parse(c.generatedAt))
  );
}
const request = createIdentityRequest();
export function readBriefing(
  tenant: string,
  conversation: string,
  task: string,
  revision: number,
  attempt: number,
  signal: AbortSignal,
) {
  if (![tenant, conversation, task].every(uuid)) throw new Error('INVALID_REQUEST');
  return request(
    `/api/v1/tenants/${tenant}/conversations/${conversation}/tasks/${task}/briefing?revision=${revision}&attempt=${attempt}`,
    'GET',
    isBriefingDocument,
    undefined,
    signal,
  );
}
export function formatBriefingNumber(v: string | null) {
  if (v === null) return '缺数据';
  const [integer, fraction] = v.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction);
}

export const briefingTypeLabels: Record<string, string> = {
  INFO: '资讯',
  DATA: '数据',
  INSIGHT: '洞察',
  SUGGESTION: '建议',
  RESULT: '成果',
};
