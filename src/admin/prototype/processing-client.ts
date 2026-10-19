import type { FoundationProcessing } from '../../../contracts/public-api/foundation-processing';
import { createIdentityRequest, record, text } from '../../identity/client.ts';
export type { FoundationProcessing } from '../../../contracts/public-api/foundation-processing';
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const time = (v: unknown) => text(v) && Number.isFinite(Date.parse(v));
const nullableTime = (v: unknown) => v === null || time(v);
export function isFoundationProcessing(v: unknown): v is FoundationProcessing {
  return (
    record(v) &&
    text(v.assetId) &&
    text(v.name) &&
    count(v.version) &&
    text(v.revision) &&
    ['DATASET_ROWS', 'DOCUMENT_CHUNKS'].includes(String(v.recordKind)) &&
    count(v.recordCount) &&
    count(v.offset) &&
    typeof v.hasMore === 'boolean' &&
    strings(v.notes) &&
    Array.isArray(v.fields) &&
    v.fields.every(
      (f) =>
        record(f) &&
        [f.name, f.type, f.meaning, f.origin, f.evidence].every(text) &&
        typeof f.unit === 'string',
    ) &&
    new Set(v.fields.map((f) => f.name)).size === v.fields.length &&
    Array.isArray(v.records) &&
    v.records.length <= 20 &&
    v.records.every(
      (r) =>
        Array.isArray(r) &&
        r.length === (v.fields as unknown[]).length &&
        r.every((c) => c === null || typeof c === 'string'),
    ) &&
    Array.isArray(v.stages) &&
    v.stages.every(
      (s) =>
        record(s) &&
        [s.key, s.name, s.state, s.detail].every(text) &&
        nullableTime(s.at) &&
        strings(s.outputs) &&
        strings(s.fields),
    ) &&
    Array.isArray(v.history) &&
    v.history.every(
      (h) =>
        record(h) &&
        [h.id, h.stage, h.state, h.detail].every(text) &&
        time(h.createdAt) &&
        nullableTime(h.finishedAt),
    )
  );
}
export const processingClient = {
  read(tenant: string, asset: string, offset: number, revision: string | undefined, signal?: AbortSignal) {
    const params = new URLSearchParams({ offset: String(offset), limit: '20' });
    if (revision) params.set('revision', revision);
    return createIdentityRequest()(
      `/api/v1/tenants/${encodeURIComponent(tenant)}/foundation/assets/${encodeURIComponent(asset)}/processing?${params}`,
      'GET',
      (v): v is FoundationProcessing =>
        isFoundationProcessing(v) &&
        v.assetId === asset &&
        v.offset === offset &&
        (!revision || v.revision === revision),
      undefined,
      signal,
    );
  },
};
