import { randomUUID, createHash } from 'node:crypto';
import { isRecord } from './http-json.js';
import { RuntimeError } from './ports.js';
export const ARTIFACT_MAX_BYTES = 20 * 1024 * 1024;
export const ARTIFACT_CHUNK_BYTES = 256 * 1024;
type Invoke = (action: string, body: unknown) => Promise<unknown>;
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const types: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  html: 'text/html',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
};
/** Only the runner sees this API; upload capabilities and base64 never enter model context. */
export async function uploadArtifact(
  invoke: Invoke,
  file: { name: string; sha256: string; bytes: Uint8Array },
  signal: AbortSignal,
) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(file.name) ||
    !file.bytes.length ||
    file.bytes.length > ARTIFACT_MAX_BYTES ||
    createHash('sha256').update(file.bytes).digest('hex') !== file.sha256
  )
    throw new RuntimeError('INVALID_ARTIFACT');
  const mediaType = types[file.name.split('.').at(-1)?.toLowerCase() ?? ''];
  if (!mediaType) throw new RuntimeError('INVALID_ARTIFACT');
  const call = async (action: string, body: unknown) => {
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw new RuntimeError('CANCELLED');
      try {
        return await invoke(action, body);
      } catch (error) {
        if (!(error instanceof RuntimeError) || error.code !== 'REMOTE_UNAVAILABLE' || attempt >= 1)
          throw error;
      }
    }
  };
  let uploadId: string | undefined;
  const receipt = (value: unknown) => {
    if (
      !isRecord(value) ||
      value.contractVersion !== '1.0' ||
      !uuid(value.uploadId) ||
      (uploadId !== undefined && uploadId !== value.uploadId) ||
      value.bytes !== file.bytes.length ||
      value.sha256 !== file.sha256 ||
      value.chunkBytes !== ARTIFACT_CHUNK_BYTES ||
      !['UPLOADING', 'READY'].includes(String(value.state)) ||
      typeof value.receivedBytes !== 'number' ||
      !Number.isSafeInteger(value.receivedBytes) ||
      value.receivedBytes < 0 ||
      value.receivedBytes > file.bytes.length ||
      (value.state === 'READY' && value.receivedBytes !== file.bytes.length)
    )
      throw new RuntimeError('INVALID_ARTIFACT_RECEIPT');
    uploadId = value.uploadId;
    return { uploadId: value.uploadId, receivedBytes: value.receivedBytes, state: value.state };
  };
  const prepared = receipt(
    await call('artifacts/prepare', {
      clientKey: randomUUID(),
      filename: file.name,
      mediaType,
      bytes: file.bytes.length,
      sha256: file.sha256,
    }),
  );
  let offset = prepared.receivedBytes;
  while (offset < file.bytes.length) {
    const part = file.bytes.subarray(offset, Math.min(offset + ARTIFACT_CHUNK_BYTES, file.bytes.length));
    const next = receipt(
      await call(`artifacts/${uploadId}/chunk`, {
        offset,
        contentBase64: Buffer.from(part).toString('base64'),
      }),
    );
    if (next.receivedBytes !== offset + part.length || next.state !== 'UPLOADING')
      throw new RuntimeError('INVALID_ARTIFACT_RECEIPT');
    offset = next.receivedBytes;
  }
  const finished = receipt(await call(`artifacts/${uploadId}/complete`, {}));
  if (finished.state !== 'READY') throw new RuntimeError('INVALID_ARTIFACT_RECEIPT');
  return { name: file.name, sha256: file.sha256, uploadId: finished.uploadId };
}
