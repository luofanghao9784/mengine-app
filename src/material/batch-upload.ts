import type { MaterialUploadReceipt } from './client.ts';
import type { MaterialEntry } from '../../contracts/public-api/material.ts';
import { IdentityError } from '../identity/client.ts';

export const parsedExtensions = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'docx',
  'xlsx',
  'xls',
  'pdf',
  'png',
  'jpg',
  'jpeg',
]);
export const normalizedName = (value: string) => value.trim().normalize('NFC');
export function validName(value: string) {
  const name = normalizedName(value);
  return !!name && name.length <= 180 && name !== '.' && name !== '..' && !/[\\/\p{Cc}\p{Cf}]/u.test(name);
}
export type UploadState = 'ready' | 'uploading' | 'succeeded' | 'failed' | 'uncertain';
export interface BatchFile {
  id: string;
  file: File;
  localPath: string;
  selectionId?: string;
  parts: string[];
  selected: boolean;
  problem?: string;
  parseSupported: boolean;
  requestId: string;
  state: UploadState;
  message?: string;
  receipt?: MaterialUploadReceipt;
}
export function scanFiles(
  files: readonly File[],
  maxBytes: number,
  parentDepth: number,
  key = () => crypto.randomUUID(),
): BatchFile[] {
  return files.map((file) => {
    const localPath = file.webkitRelativePath || file.name;
    const original = localPath.split('/');
    const parts = original.map(normalizedName);
    const problem =
      original.some((part) => !validName(part)) || parts.at(-1) !== normalizedName(file.name)
        ? '文件路径或名称不支持；请先在本地调整名称。'
        : file.size > maxBytes
          ? '超过当前空间的单文件上传上限。'
          : parentDepth + parts.length > 32
            ? '目标目录加所选路径超过 32 层；请选择较浅的目录。'
            : undefined;
    return {
      id: key(),
      file,
      localPath,
      parts,
      selected: !problem,
      problem,
      parseSupported: parsedExtensions.has(file.name.split('.').at(-1)?.toLowerCase() || ''),
      requestId: key(),
      state: 'ready',
    };
  });
}
/** Detect collisions after the same NFC/trim normalization used by the server. */
export function selectedConflicts(rows: readonly BatchFile[]) {
  const exact = new Map<string, string[]>(),
    prefixes = new Map<string, string[]>();
  for (const row of rows.filter((r) => r.selected && !r.problem)) {
    const path = row.parts.join('/');
    exact.set(path, [...(exact.get(path) || []), row.id]);
    for (let i = 1; i < row.parts.length; i++) {
      const prefix = row.parts.slice(0, i).join('/');
      prefixes.set(prefix, [...(prefixes.get(prefix) || []), row.id]);
    }
  }
  const conflicts = new Set<string>();
  for (const [path, ids] of exact) {
    if (ids.length > 1 || prefixes.has(path)) {
      ids.forEach((id) => conflicts.add(id));
      prefixes.get(path)?.forEach((id) => conflicts.add(id));
    }
  }
  return conflicts;
}
export const uploadError = (error: unknown) => {
  if (error instanceof IdentityError) {
    if (
      ['UNCERTAIN_RESULT', 'CONTRACT_MISMATCH', 'CANCELLED', 'UNAVAILABLE'].includes(error.code) ||
      error.status >= 500
    )
      return '连接中断，保存结果待确认；请在此重试以核对原上传。';
    if (['MATERIAL_NAME_CONFLICT', 'MATERIAL_FOLDER_CONFLICT'].includes(error.code))
      return '目标已有同名项目；未合并或覆盖。请核对资料库。';
    return error.message;
  }
  return '传输中断，结果尚未确认；请使用本批次的重试按钮核对。';
};
export const uncertainUpload = (error: unknown) =>
  !(error instanceof IdentityError) ||
  ['UNCERTAIN_RESULT', 'CONTRACT_MISMATCH', 'CANCELLED', 'UNAVAILABLE'].includes(error.code) ||
  error.status >= 500;
export const permissionError = (error: unknown) =>
  error instanceof IdentityError && [401, 403, 404].includes(error.status);
export interface BatchDestination {
  tenant: string;
  workspace: string;
  parentId: string | null;
}
export interface BatchTransport {
  list(
    tenant: string,
    workspace: string,
    folder: string | null,
    q: string,
    offset: number,
    signal?: AbortSignal,
  ): Promise<{ items: MaterialEntry[]; hasMore: boolean; canMaintain: boolean }>;
  folder(
    tenant: string,
    workspace: string,
    body: { requestId: string; parentId: string | null; name: string },
    signal?: AbortSignal,
  ): Promise<{ id: string; name: string }>;
  upload(
    tenant: string,
    workspace: string,
    metadata: { requestId: string; folderId: string | null },
    file: File,
    document?: string,
    signal?: AbortSignal,
  ): Promise<MaterialUploadReceipt>;
}
/** Reserve a visible, deterministic name without changing its extension. */
export function availableName(value: string, names: Set<string>, file = false) {
  const name = normalizedName(value);
  const dot = file ? name.lastIndexOf('.') : -1;
  const extension = dot > 0 ? name.slice(dot) : '';
  const stem = extension ? name.slice(0, dot) : name;
  let candidate = name;
  for (let n = 1; names.has(candidate); n++) {
    const suffix = ` (${n})`;
    // A rare 179-character extension must also leave space for a stem and suffix.
    const ext = extension.slice(0, 170);
    const prefix = Array.from(stem).reduce(
      (s, c) => (s.length + c.length <= 180 - suffix.length - ext.length ? s + c : s),
      '',
    );
    candidate = prefix + suffix + ext;
  }
  names.add(candidate);
  return candidate;
}
export async function destinationNames(
  api: BatchTransport,
  destination: BatchDestination,
  signal?: AbortSignal,
) {
  const names = new Set<string>();
  for (let offset = 0; ; offset += 24) {
    const page = await api.list(
      destination.tenant,
      destination.workspace,
      destination.parentId,
      '',
      offset,
      signal,
    );
    if (!page.canMaintain) throw new IdentityError('MATERIAL_READ_ONLY', 403);
    page.items.forEach((item) => names.add(normalizedName(item.name)));
    if (!page.hasMore) return names;
  }
}
/** Folder selections remain independent copies, including when selected more than once. */
export function planUpload(rows: readonly BatchFile[], occupied: ReadonlySet<string>): BatchFile[] {
  const names = new Map<string, Set<string>>([['', new Set(occupied)]]);
  const folders = new Map<string, string[]>();
  return rows
    .filter((row) => row.selected && !row.problem)
    .map((row) => {
      const original = row.localPath.split('/').map(normalizedName);
      const parts: string[] = [];
      for (let i = 0; i < original.length - 1; i++) {
        const source = JSON.stringify([row.selectionId || '', original.slice(0, i + 1)]);
        let folder = folders.get(source);
        if (!folder) {
          const name = availableName(original[i], names.get(parts.join('/'))!);
          folder = [...parts, name];
          folders.set(source, folder);
          names.set(folder.join('/'), new Set());
        }
        parts.splice(0, parts.length, ...folder);
      }
      parts.push(availableName(original.at(-1)!, names.get(parts.join('/'))!, true));
      return { ...row, parts };
    });
}
interface FolderRequest {
  requestId: string;
  id?: string;
  name: string;
  parentPath: string;
}
/** Serial writes; retries retain the exact name, bytes, destination and request key. */
export class BatchUploadRun {
  readonly destination: BatchDestination;
  readonly files: BatchFile[];
  private readonly folders = new Map<string, FolderRequest>();
  private readonly uploadFiles = new Map<string, File>();
  private planned = false;
  private stopping = false;
  private running = false;
  constructor(destination: BatchDestination, rows: readonly BatchFile[]) {
    this.destination = { ...destination };
    this.files = rows
      .filter((r) => r.selected && !r.problem)
      .map((row) => ({ ...row, parts: [...row.parts] }));
  }
  stop() {
    this.stopping = true;
  }
  private async prepare(api: BatchTransport, signal?: AbortSignal) {
    if (this.planned) return;
    const rows = planUpload(this.files, await destinationNames(api, this.destination, signal));
    rows.forEach((row, index) => {
      Object.assign(this.files[index], row);
      const name = row.parts.at(-1)!;
      this.uploadFiles.set(
        row.id,
        new File([row.file], name, { type: row.file.type, lastModified: row.file.lastModified }),
      );
      for (let i = 1; i < row.parts.length; i++) {
        const path = row.parts.slice(0, i).join('/');
        if (!this.folders.has(path))
          this.folders.set(path, {
            requestId: crypto.randomUUID(),
            name: row.parts[i - 1],
            parentPath: row.parts.slice(0, i - 1).join('/'),
          });
      }
    });
    this.planned = true;
  }
  private async folder(path: string, api: BatchTransport, signal?: AbortSignal): Promise<string | null> {
    if (!path) return this.destination.parentId;
    const folder = this.folders.get(path)!;
    if (folder.id) return folder.id;
    const parentId = await this.folder(folder.parentPath, api, signal);
    const result = await api.folder(
      this.destination.tenant,
      this.destination.workspace,
      { requestId: folder.requestId, parentId, name: folder.name },
      signal,
    );
    folder.id = result.id;
    return result.id;
  }
  async execute(api: BatchTransport, mode: 'ready' | 'retry', changed: () => void, signal?: AbortSignal) {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    try {
      await this.prepare(api, signal);
      changed();
      for (const row of this.files) {
        if (this.stopping || signal?.aborted) break;
        if (!(mode === 'ready' ? row.state === 'ready' : ['failed', 'uncertain'].includes(row.state)))
          continue;
        row.state = 'uploading';
        row.message = undefined;
        changed();
        let fileSent = false;
        try {
          const folderId = await this.folder(row.parts.slice(0, -1).join('/'), api, signal);
          if (this.stopping || signal?.aborted) {
            row.state = 'ready';
            changed();
            break;
          }
          fileSent = true;
          const receipt = await api.upload(
            this.destination.tenant,
            this.destination.workspace,
            { requestId: row.requestId, folderId },
            this.uploadFiles.get(row.id)!,
            undefined,
            signal,
          );
          row.receipt = receipt;
          row.state = receipt.receiptStatus === 'EXACT' ? 'succeeded' : 'uncertain';
          row.message = receipt.receiptStatus === 'EXACT' ? undefined : '保存结果待确认，请重试核对。';
        } catch (error) {
          row.state = uncertainUpload(error) ? 'uncertain' : 'failed';
          row.message = uploadError(error);
          if (!fileSent || permissionError(error)) {
            this.stopping = true;
            if (permissionError(error)) throw error;
          }
        }
        changed();
      }
    } finally {
      this.running = false;
    }
  }
}
