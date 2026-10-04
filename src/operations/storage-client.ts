import { createIdentityRequest, record, uuid } from '../identity/client.ts';
import { backupCommands, type StorageStatus } from '../../contracts/public-api/storage-status.ts';
const exact = (v: unknown, keys: string): v is Record<string, unknown> =>
  record(v) && Object.keys(v).sort().join(' ') === keys.split(' ').sort().join(' ');
const num = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const date = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 40 && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const nd = (v: unknown) => v === null || date(v);
export function isStorageStatus(v: unknown): v is StorageStatus {
  if (!exact(v, 'checkedAt storage cleanup backup') || !date(v.checkedAt)) return false;
  const s = v.storage,
    c = v.cleanup,
    b = v.backup;
  if (
    !exact(s, 'databaseBytes knowledgeBytes registeredOriginalBytes originalVolume') ||
    !num(s.databaseBytes) ||
    !num(s.knowledgeBytes) ||
    !num(s.registeredOriginalBytes)
  )
    return false;
  const vol = s.originalVolume;
  if (
    !exact(vol, 'state totalBytes usableBytes') ||
    !['NOT_CONFIGURED', 'UNAVAILABLE', 'OBSERVED'].includes(String(vol.state)) ||
    (vol.state === 'OBSERVED'
      ? !num(vol.totalBytes) || !num(vol.usableBytes) || vol.usableBytes > vol.totalBytes
      : vol.totalBytes !== null || vol.usableBytes !== null)
  )
    return false;
  if (
    !exact(c, 'queued running failed completed lastCompletedAt') ||
    ![c.queued, c.running, c.failed, c.completed].every(num) ||
    !nd(c.lastCompletedAt)
  )
    return false;
  if (
    !exact(b, 'state updatedAt staleSeconds events') ||
    !['NOT_CONFIGURED', 'UNAVAILABLE', 'FRESH', 'STALE'].includes(String(b.state)) ||
    !num(b.staleSeconds) ||
    b.staleSeconds < 60 ||
    b.staleSeconds > 604800 ||
    !Array.isArray(b.events) ||
    b.events.length > 40
  )
    return false;
  if (['NOT_CONFIGURED', 'UNAVAILABLE'].includes(String(b.state)))
    return b.updatedAt === null && b.events.length === 0;
  if (!date(b.updatedAt)) return false;
  const ids = new Set();
  return b.events.every((e) => {
    if (
      !exact(e, 'id command state startedAt finishedAt snapshot') ||
      !uuid(e.id) ||
      ids.has(e.id) ||
      !backupCommands.includes(e.command as (typeof backupCommands)[number]) ||
      !['RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(String(e.state)) ||
      !date(e.startedAt) ||
      !nd(e.finishedAt)
    )
      return false;
    ids.add(e.id);
    if (
      Date.parse(e.startedAt) > Date.parse(b.updatedAt as string) ||
      (e.state === 'RUNNING' && e.finishedAt !== null) ||
      (e.state !== 'RUNNING' && e.state !== 'UNKNOWN' && e.finishedAt === null) ||
      (e.finishedAt !== null &&
        (Date.parse(e.finishedAt as string) < Date.parse(e.startedAt) ||
          Date.parse(e.finishedAt as string) > Date.parse(b.updatedAt as string)))
    )
      return false;
    if (e.snapshot === null) return true;
    const p = e.snapshot;
    return (
      e.state === 'SUCCEEDED' &&
      e.command !== 'ROTATE' &&
      exact(p, 'id createdAt expiresAt bytes files tables') &&
      uuid(p.id) &&
      date(p.createdAt) &&
      date(p.expiresAt) &&
      Date.parse(p.expiresAt) > Date.parse(p.createdAt) &&
      e.finishedAt !== null &&
      Date.parse(p.createdAt) <= Date.parse(e.finishedAt as string) &&
      [p.bytes, p.files, p.tables].every(num)
    );
  });
}
export function createStorageClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  return {
    status: (signal?: AbortSignal) =>
      request('/api/platform-admin/v1/storage-status', 'GET', isStorageStatus, undefined, signal),
  };
}
export const storageClient = createStorageClient();
