import { createHash } from 'node:crypto';
import { isRecord } from './http-json.js';
import { RuntimeError, type Json, type TaskTool } from './ports.js';
import type { TaskFile } from './sandbox.js';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
type Original = {
  materialId: string;
  versionId: string;
  filename: string;
  version: number;
  bytes: number;
  sha256: string;
};

/** Explicit, platform-pinned versions only. Binary bytes never become model tool output. */
export class OriginalInputs {
  private selected: Original[] | undefined;
  private loaded = new Map<string, TaskFile>();
  constructor(
    private invoke: (action: string, body: unknown, limit?: number) => Promise<unknown>,
    private authorize: () => Promise<void>,
  ) {}
  private async list() {
    await this.authorize();
    const response = await this.invoke('originals', {});
    if (!isRecord(response) || !Array.isArray(response.items) || response.items.length > 3)
      throw new RuntimeError('INVALID_ORIGINAL_RESPONSE');
    const items: Original[] = [];
    let total = 0;
    for (const f of response.items) {
      if (
        !isRecord(f) ||
        !uuid(f.versionId) ||
        !uuid(f.materialId) ||
        typeof f.filename !== 'string' ||
        !f.filename ||
        f.filename.length > 180 ||
        !Number.isSafeInteger(f.version) ||
        Number(f.version) < 1 ||
        !Number.isSafeInteger(f.bytes) ||
        Number(f.bytes) < 0 ||
        Number(f.bytes) > 262144 ||
        typeof f.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(f.sha256)
      )
        throw new RuntimeError('INVALID_ORIGINAL_RESPONSE');
      total += Number(f.bytes);
      items.push({
        materialId: f.materialId,
        versionId: f.versionId,
        filename: f.filename,
        version: Number(f.version),
        bytes: Number(f.bytes),
        sha256: f.sha256,
      });
    }
    if (
      total > 524288 ||
      new Set(items.map((f) => f.versionId)).size !== items.length ||
      new Set(items.map((f) => f.materialId)).size !== items.length
    )
      throw new RuntimeError('INVALID_ORIGINAL_RESPONSE');
    items.sort((a, b) => a.versionId.localeCompare(b.versionId));
    if (this.selected && JSON.stringify(this.selected) !== JSON.stringify(items))
      throw new RuntimeError('ORIGINAL_SELECTION_CHANGED');
    this.selected = items;
    return items;
  }
  files(): TaskFile[] {
    return [...this.loaded.values()];
  }
  ids(): string[] {
    return [...this.loaded.keys()];
  }
  loadedOriginal(versionId: string) {
    const metadata = this.selected?.find((item) => item.versionId === versionId);
    const file = this.loaded.get(versionId);
    return metadata && file ? { metadata: { ...metadata }, file } : undefined;
  }
  close() {
    for (const f of this.loaded.values()) f.bytes.fill(0);
    this.loaded.clear();
    this.selected = undefined;
  }
  tools(): TaskTool[] {
    return [
      {
        name: 'list_originals',
        description:
          'List only complete file versions explicitly selected by the user for this task. An empty list does not grant browsing or access to other originals.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => ({ items: await this.list(), scope: 'user-selected-originals' }) as Json,
      },
      {
        name: 'read_original',
        description:
          'Stage one exact selected original in the offline task input area. Returns a handle and byte/hash metadata, never binary file contents. Use run_javascript with inputHandles to process its complete bytes. Loading is not proof of understanding or format support.',
        parameters: {
          type: 'object',
          properties: { versionId: { type: 'string' } },
          required: ['versionId'],
          additionalProperties: false,
        },
        execute: async (args) => {
          const { versionId } = args as { versionId: string };
          const selected = (await this.list()).find((f) => f.versionId === versionId);
          if (!selected) throw new RuntimeError('ORIGINAL_NOT_SELECTED');
          const response = await this.invoke('read-original', { versionId }, 400000);
          if (
            !isRecord(response) ||
            response.versionId !== versionId ||
            response.sha256 !== selected.sha256 ||
            typeof response.contentBase64 !== 'string' ||
            response.contentBase64.length > 349528
          )
            throw new RuntimeError('INVALID_ORIGINAL_RESPONSE');
          const bytes = Buffer.from(response.contentBase64, 'base64');
          if (
            bytes.length !== selected.bytes ||
            bytes.toString('base64') !== response.contentBase64 ||
            createHash('sha256').update(bytes).digest('hex') !== selected.sha256
          )
            throw new RuntimeError('INVALID_ORIGINAL_RESPONSE');
          await this.authorize();
          const handle = 'original-' + versionId + '.bin';
          this.loaded.set(versionId, { handle, bytes });
          return { ...selected, inputHandle: handle, scope: 'complete-original', contentsSentToModel: false };
        },
      },
    ];
  }
}
