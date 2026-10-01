import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BatchUploadRun,
  checkBatchFolder,
  scanFiles,
  selectedConflicts,
  validName,
  type BatchTransport,
} from '../src/material/batch-upload.ts';
import type { MaterialUploadReceipt } from '../src/material/client.ts';
import { IdentityError } from '../src/identity/client.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const destination = { tenant: id(1), workspace: id(2), parentId: null, name: '本次导入' };
function file(name: string, path = name, body = 'data') {
  const value = new File([body], name);
  Object.defineProperty(value, 'webkitRelativePath', { value: path });
  return value;
}
function scanned(files: File[], depth = 0) {
  let key = 100;
  return scanFiles(files, 100, depth, () => id(key++));
}
function receipt(name: string, number = 1): MaterialUploadReceipt {
  return {
    id: id(8),
    tenantId: id(1),
    workspaceId: id(2),
    workspaceName: '合成',
    folderId: id(3),
    kind: 'DOCUMENT',
    name,
    version: number,
    sizeBytes: 4,
    updatedAt: '2026-10-01T00:00:00Z',
    path: ['合成', name],
    canMaintain: true,
    receiptStatus: 'EXACT',
    currentVersion: number,
    acceptedVersion: {
      id: id(9),
      number,
      filename: name,
      sizeBytes: 4,
      sha256: 'a'.repeat(64),
      createdBy: id(4),
      createdAt: '2026-10-01T00:00:00Z',
    },
  };
}
function transport(overrides: Partial<BatchTransport> = {}): BatchTransport {
  let seq = 500;
  return {
    list: async () => ({ items: [], hasMore: false, canMaintain: true }),
    folder: async (_t, _w, body) => ({ id: id(seq++), name: body.name }),
    upload: async (_t, _w, _body, f) => receipt(f.name),
    ...overrides,
  };
}

test('selected FileList metadata preserves paths, rejects unsafe names/oversize/depth, and keeps unsupported originals selectable', () => {
  const rows = scanned([
    file('a.txt', '目录/a.txt'),
    file('movie.mov'),
    file('bad.txt', '../bad.txt'),
    file('huge', 'huge', 'a'.repeat(101)),
    file('x\u200b.txt'),
  ]);
  assert.deepEqual(rows[0].parts, ['目录', 'a.txt']);
  assert.equal(rows[0].parseSupported, true);
  assert.equal(rows[1].parseSupported, false);
  assert.equal(rows[1].selected, true);
  assert.ok(rows.slice(2).every((r) => r.problem && !r.selected));
  assert.ok(scanned([file('a', 'd/a')], 31)[0].problem);
  assert.equal(scanned([file('a')], 31)[0].problem, undefined);
  assert.equal(validName('a/b'), false);
  assert.equal(validName(' .. '), false);
});

test('normalized duplicate names and file-directory collisions require an explicit selection change', () => {
  const rows = scanned([file('é.txt'), file('e\u0301.txt'), file('folder'), file('x', 'folder/x')]);
  assert.equal(selectedConflicts(rows).size, 4);
  rows[1].selected = false;
  rows[2].selected = false;
  assert.equal(selectedConflicts(rows).size, 0);
  const bad = scanned([file('same'), file('same')]);
  assert.throws(() => new BatchUploadRun(destination, bad));
});

test('preflight checks beyond the first page and never merges a pre-existing root', async () => {
  let lists = 0,
    creates = 0;
  const api = transport({
    list: async (_t, _w, _f, _q, offset) => {
      lists++;
      return {
        items: offset ? [{ ...receipt('本次导入'), kind: 'DOCUMENT' }] : [],
        canMaintain: true,
        hasMore: !offset,
      };
    },
    folder: async () => {
      creates++;
      return { id: id(3), name: '本次导入' };
    },
  });
  await assert.rejects(
    checkBatchFolder(api, destination),
    (e) => e instanceof IdentityError && e.code === 'MATERIAL_NAME_CONFLICT',
  );
  assert.equal(lists, 2);
  assert.equal(creates, 0);
  const batch = new BatchUploadRun(destination, scanned([file('one')]));
  await batch.execute(api, 'ready', () => {});
  assert.equal(batch.files[0].state, 'failed');
  assert.equal(creates, 0);
});

test('lost file response retries the same request only; successful files and directories are not duplicated', async () => {
  const calls: string[] = [],
    keys: string[] = [];
  let folders = 0,
    failures = 0;
  const api = transport({
    folder: async (_t, _w, body) => {
      folders++;
      return { id: id(3), name: body.name };
    },
    upload: async (_t, _w, body, f) => {
      calls.push(f.name);
      keys.push(body.requestId);
      if (f.name === 'two' && failures++ === 0) throw new IdentityError('UNCERTAIN_RESULT');
      return receipt(f.name);
    },
  });
  const batch = new BatchUploadRun(destination, scanned([file('one', 'dir/one'), file('two', 'dir/two')]));
  await batch.execute(api, 'ready', () => {});
  assert.deepEqual(
    batch.files.map((r) => r.state),
    ['succeeded', 'uncertain'],
  );
  await batch.execute(api, 'retry', () => {});
  assert.deepEqual(calls, ['one', 'two', 'two']);
  assert.equal(keys[1], keys[2]);
  assert.equal(folders, 2);
  await batch.execute(api, 'ready', () => {});
  await batch.execute(api, 'retry', () => {});
  assert.equal(calls.length, 3);
});

test('lost folder response retries its original key without rejecting its own committed directory', async () => {
  const keys: string[] = [];
  let lists = 0,
    committed = false;
  const api = transport({
    list: async () => {
      lists++;
      return { items: committed ? [receipt(destination.name)] : [], canMaintain: true, hasMore: false };
    },
    folder: async (_t, _w, body) => {
      keys.push(body.requestId);
      if (!committed) {
        committed = true;
        throw new IdentityError('UNCERTAIN_RESULT');
      }
      return { id: id(3), name: body.name };
    },
  });
  const batch = new BatchUploadRun(destination, scanned([file('one')]));
  await batch.execute(api, 'ready', () => {});
  assert.equal(batch.files[0].state, 'uncertain');
  await batch.execute(api, 'retry', () => {});
  assert.equal(batch.files[0].state, 'succeeded');
  assert.equal(lists, 1);
  assert.equal(keys[0], keys[1]);
});

test('stop waits for in-flight receipt, leaves unstarted files pending, and continue sends only pending files', async () => {
  let release!: () => void,
    calls = 0;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const api = transport({
    upload: async (_t, _w, _b, f) => {
      calls++;
      if (calls === 1) await held;
      return receipt(f.name);
    },
  });
  const batch = new BatchUploadRun(destination, scanned([file('one'), file('two')]));
  const running = batch.execute(api, 'ready', () => {});
  await new Promise((resolve) => setImmediate(resolve));
  await batch.execute(api, 'ready', () => {});
  batch.stop();
  release();
  await running;
  assert.equal(calls, 1);
  assert.deepEqual(
    batch.files.map((r) => r.state),
    ['succeeded', 'ready'],
  );
  await batch.execute(api, 'ready', () => {});
  assert.equal(calls, 2);
});

test('revocation stops remaining requests, and unknown historical receipt never becomes confirmed success', async () => {
  let calls = 0;
  const batch = new BatchUploadRun(destination, scanned([file('one'), file('two')]));
  await batch.execute(
    transport({
      upload: async () => {
        calls++;
        throw new IdentityError('MATERIAL_READ_ONLY', 403);
      },
    }),
    'ready',
    () => {},
  );
  assert.equal(calls, 1);
  assert.deepEqual(
    batch.files.map((r) => r.state),
    ['failed', 'ready'],
  );
  const unknown = new BatchUploadRun(destination, scanned([file('one')]));
  await unknown.execute(
    transport({
      upload: async () => ({ ...receipt('one'), receiptStatus: 'HISTORICAL_UNKNOWN', acceptedVersion: null }),
    }),
    'ready',
    () => {},
  );
  assert.equal(unknown.files[0].state, 'uncertain');
});

test('an uncertain shared directory is not automatically retried by the next file in the same run', async () => {
  let calls = 0;
  const batch = new BatchUploadRun(destination, scanned([file('one'), file('two')]));
  await batch.execute(
    transport({
      folder: async () => {
        calls++;
        throw new IdentityError('UNCERTAIN_RESULT');
      },
    }),
    'ready',
    () => {},
  );
  assert.equal(calls, 1);
  assert.deepEqual(
    batch.files.map((r) => r.state),
    ['uncertain', 'ready'],
  );
});
