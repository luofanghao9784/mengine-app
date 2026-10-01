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
  name: string;
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
export async function checkBatchFolder(
  api: BatchTransport,
  destination: BatchDestination,
  signal?: AbortSignal,
) {
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
    if (page.items.some((item) => normalizedName(item.name) === normalizedName(destination.name)))
      throw new IdentityError('MATERIAL_NAME_CONFLICT', 409);
    if (!page.hasMore) return;
  }
}
interface FolderRequest {
  requestId: string;
  id?: string;
  name: string;
  parentPath: string | null;
  sent: boolean;
}
/** Serial, explicit retries; successful files and created folders never restart. */
export class BatchUploadRun {
  readonly destination: BatchDestination;
  readonly files: BatchFile[];
  private readonly folders = new Map<string, FolderRequest>();
  private stopping = false;
  private running = false;
  constructor(destination: BatchDestination, rows: readonly BatchFile[], key = () => crypto.randomUUID()) {
    this.destination = { ...destination, name: normalizedName(destination.name) };
    if (!validName(this.destination.name) || selectedConflicts(rows).size)
      throw new Error('请先处理名称和路径冲突。');
    this.files = rows.filter((r) => r.selected && !r.problem).map((row) => ({ ...row }));
    this.folders.set('', { requestId: key(), name: this.destination.name, parentPath: null, sent: false });
    for (const row of this.files) {
      for (let i = 1; i < row.parts.length; i++) {
        const path = row.parts.slice(0, i).join('/');
        if (!this.folders.has(path))
          this.folders.set(path, {
            requestId: key(),
            name: row.parts[i - 1],
            parentPath: row.parts.slice(0, i - 1).join('/'),
            sent: false,
          });
      }
    }
  }
  get folderId() {
    return this.folders.get('')?.id;
  }
  stop() {
    this.stopping = true;
  }
  private async folder(path: string, api: BatchTransport, signal?: AbortSignal): Promise<string> {
    const folder = this.folders.get(path)!;
    if (folder.id) return folder.id;
    const { tenant, workspace, parentId } = this.destination;
    const parent = folder.parentPath === null ? parentId : await this.folder(folder.parentPath, api, signal);
    // Do not mistake our own committed-but-unacknowledged folder for another batch on retry.
    if (!folder.sent) {
      await checkBatchFolder(api, { tenant, workspace, parentId: parent, name: folder.name }, signal);
    }
    folder.sent = true;
    const result = await api.folder(
      tenant,
      workspace,
      { requestId: folder.requestId, parentId: parent, name: folder.name },
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
          const { tenant, workspace } = this.destination;
          fileSent = true;
          const receipt = await api.upload(
            tenant,
            workspace,
            { requestId: row.requestId, folderId },
            row.file,
            undefined,
            signal,
          );
          row.receipt = receipt;
          row.state = receipt.receiptStatus === 'EXACT' ? 'succeeded' : 'uncertain';
          row.message =
            receipt.receiptStatus === 'EXACT'
              ? `已保存 v${receipt.acceptedVersion!.number}`
              : '历史请求已登记，但接受版本无法可靠确认。请在资料详情核对。';
        } catch (error) {
          row.state = uncertainUpload(error) ? 'uncertain' : 'failed';
          row.message = uploadError(error);
          if (!fileSent || permissionError(error)) this.stopping = true;
        }
        changed();
      }
    } finally {
      this.running = false;
    }
  }
}
