import test from 'node:test';
import { UploadQueue } from '../src/material/upload-queue.ts';
import assert from 'node:assert/strict';
import {
  BatchUploadRun,
  availableName,
  destinationNames,
  planUpload,
  scanFiles,
  selectedConflicts,
  validName,
  type BatchTransport,
} from '../src/material/batch-upload.ts';
import type { MaterialUploadReceipt } from '../src/material/client.ts';
import { IdentityError } from '../src/identity/client.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const destination = { tenant: id(1), workspace: id(2), parentId: null };
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

test('selected files preserve authorized relative paths and reject invalid names, size and depth', () => {
  const rows = scanned([
    file('a.txt', '目录/a.txt'),
    file('movie.mov'),
    file('bad.txt', '../bad.txt'),
    file('huge', 'huge', 'a'.repeat(101)),
    file('x\u200b.txt'),
  ]);
  assert.deepEqual(rows[0].parts, ['目录', 'a.txt']);
  assert.equal(rows[1].selected, true);
  assert.equal(rows[1].parseSupported, false);
  assert.ok(rows.slice(2).every((r) => r.problem && !r.selected));
  assert.ok(scanned([file('a', 'd/a')], 31)[0].problem);
  assert.equal(scanned([file('a')], 31)[0].problem, undefined);
  assert.equal(validName('a/b'), false);
});

test('planning keeps both files, retains extension, resolves NFC and file-folder collisions', () => {
  const rows = scanned([
    file('é.txt'),
    file('e\u0301.txt'),
    file('folder'),
    file('x', 'folder/x'),
    file('y', 'folder/y'),
  ]);
  const planned = planUpload(rows, new Set(['é.txt']));
  assert.deepEqual(
    planned.map((r) => r.parts.join('/')),
    ['é (1).txt', 'é (2).txt', 'folder', 'folder (1)/x', 'folder (1)/y'],
  );
  assert.equal(selectedConflicts(planned).size, 0);
  assert.deepEqual(rows[0].parts, ['é.txt']);
});

test('repeated folder selections are copied independently without merging', () => {
  const rows = scanned([file('a', '目录/a'), file('b', '目录/b'), file('a', '目录/a')]);
  rows[0].selectionId = rows[1].selectionId = 'first';
  rows[2].selectionId = 'second';
  assert.deepEqual(
    planUpload(rows, new Set(['目录'])).map((r) => r.parts.join('/')),
    ['目录 (1)/a', '目录 (1)/b', '目录 (2)/a'],
  );
});

test('suffix chooses the next free name and keeps a valid maximum-length Unicode filename', () => {
  assert.equal(availableName('报表.xlsx', new Set(['报表.xlsx', '报表 (1).xlsx']), true), '报表 (2).xlsx');
  const name = '😀'.repeat(87) + '.txt';
  const renamed = availableName(name, new Set([name]), true);
  assert.equal(validName(renamed), true);
  assert.ok(renamed.endsWith(' (1).txt'));
  assert.ok(renamed.length <= 180);
});

test('preflight reads all pages and refuses a read-only destination before any write', async () => {
  const offsets: number[] = [];
  const names = await destinationNames(
    transport({
      list: async (_t, _w, _f, _q, offset) => {
        offsets.push(offset);
        return { items: [receipt(offset ? 'later' : 'first')], hasMore: !offset, canMaintain: true };
      },
    }),
    destination,
  );
  assert.deepEqual(offsets, [0, 24]);
  assert.deepEqual([...names], ['first', 'later']);
  let writes = 0;
  const run = new BatchUploadRun(destination, scanned([file('one')]));
  await assert.rejects(
    run.execute(
      transport({
        list: async () => ({ items: [], hasMore: false, canMaintain: false }),
        upload: async () => {
          writes++;
          return receipt('one');
        },
      }),
      'ready',
      () => {},
    ),
  );
  assert.equal(writes, 0);
});

test('multiple files save directly in the chosen parent without an artificial batch folder', async () => {
  let folders = 0;
  const parents: (string | null)[] = [];
  const names: string[] = [];
  const run = new BatchUploadRun(
    { ...destination, parentId: id(55) },
    scanned([file('report.txt'), file('report.txt')]),
  );
  await run.execute(
    transport({
      list: async () => ({ items: [receipt('report.txt')], hasMore: false, canMaintain: true }),
      folder: async () => {
        folders++;
        return { id: id(3), name: 'unexpected' };
      },
      upload: async (_t, _w, body, f) => {
        parents.push(body.folderId);
        names.push(f.name);
        return receipt(f.name);
      },
    }),
    'ready',
    () => {},
  );
  assert.equal(folders, 0);
  assert.deepEqual(parents, [id(55), id(55)]);
  assert.deepEqual(names, ['report (1).txt', 'report (2).txt']);
});

test('renamed folders retain all children and uploaded bytes', async () => {
  const created: { parentId: string | null; name: string }[] = [];
  const parents: (string | null)[] = [];
  const run = new BatchUploadRun(destination, scanned([file('one', 'dir/sub/one'), file('two', 'dir/two')]));
  await run.execute(
    transport({
      list: async () => ({ items: [receipt('dir')], hasMore: false, canMaintain: true }),
      folder: async (_t, _w, body) => {
        created.push(body);
        return { id: id(created.length + 50), name: body.name };
      },
      upload: async (_t, _w, body, f) => {
        parents.push(body.folderId);
        assert.equal(await f.text(), 'data');
        return receipt(f.name);
      },
    }),
    'ready',
    () => {},
  );
  assert.deepEqual(
    created.map((x) => [x.parentId, x.name]),
    [
      [null, 'dir (1)'],
      [id(51), 'sub'],
    ],
  );
  assert.deepEqual(parents, [id(52), id(51)]);
});

test('lost file response retries the same name, bytes and request only, without renaming its own saved file', async () => {
  const calls: { key: string; name: string }[] = [];
  let lost = false,
    lists = 0;
  const api = transport({
    list: async () => {
      lists++;
      return { items: [receipt('two')], hasMore: false, canMaintain: true };
    },
    upload: async (_t, _w, body, f) => {
      calls.push({ key: body.requestId, name: f.name });
      if (f.name === 'two (1)' && !lost) {
        lost = true;
        throw new IdentityError('UNCERTAIN_RESULT');
      }
      return receipt(f.name);
    },
  });
  const run = new BatchUploadRun(destination, scanned([file('one'), file('two')]));
  await run.execute(api, 'ready', () => {});
  assert.deepEqual(
    run.files.map((r) => r.state),
    ['succeeded', 'uncertain'],
  );
  await run.execute(api, 'retry', () => {});
  assert.deepEqual(calls[1], calls[2]);
  assert.equal(calls.length, 3);
  assert.equal(lists, 1);
  await run.execute(api, 'retry', () => {});
  assert.equal(calls.length, 3);
});

test('lost folder response retains original request and stops siblings until explicit retry', async () => {
  const keys: string[] = [];
  let committed = false;
  const api = transport({
    folder: async (_t, _w, body) => {
      keys.push(body.requestId);
      if (!committed) {
        committed = true;
        throw new IdentityError('UNCERTAIN_RESULT');
      }
      return { id: id(3), name: body.name };
    },
  });
  const run = new BatchUploadRun(destination, scanned([file('one', 'dir/one'), file('two', 'dir/two')]));
  await run.execute(api, 'ready', () => {});
  assert.deepEqual(
    run.files.map((r) => r.state),
    ['uncertain', 'ready'],
  );
  assert.equal(keys.length, 1);
  await run.execute(api, 'retry', () => {});
  await run.execute(api, 'ready', () => {});
  assert.equal(keys[0], keys[1]);
  assert.equal(keys.length, 2);
  assert.ok(run.files.every((r) => r.state === 'succeeded'));
});

test('pause waits for receipt and continues only pending files', async () => {
  let release!: () => void,
    calls = 0;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = new BatchUploadRun(destination, scanned([file('one'), file('two')]));
  const api = transport({
    upload: async (_t, _w, _b, f) => {
      if (++calls === 1) await held;
      return receipt(f.name);
    },
  });
  const running = run.execute(api, 'ready', () => {});
  await new Promise((resolve) => setImmediate(resolve));
  run.stop();
  release();
  await running;
  assert.deepEqual(
    run.files.map((r) => r.state),
    ['succeeded', 'ready'],
  );
  await run.execute(api, 'ready', () => {});
  assert.equal(calls, 2);
});

test('unknown historical receipts never count as success', async () => {
  const run = new BatchUploadRun(destination, scanned([file('one')]));
  await run.execute(
    transport({
      upload: async () => ({ ...receipt('one'), receiptStatus: 'HISTORICAL_UNKNOWN', acceptedVersion: null }),
    }),
    'ready',
    () => {},
  );
  assert.equal(run.files[0].state, 'uncertain');
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('queue serializes submissions, survives listener/page replacement, and plans names when each job begins', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const names: string[] = [];
  const queue = new UploadQueue(
    transport({
      list: async () => ({ items: names.map((n) => receipt(n)), hasMore: false, canMaintain: true }),
      upload: async (_t, _w, _b, f) => {
        if (!names.length) await held;
        names.push(f.name);
        return receipt(f.name);
      },
    }),
  );
  const unsub = queue.subscribe(() => {});
  queue.add(destination, scanned([file('one')]), '个人空间', '#first');
  queue.add(destination, scanned([file('one')]), '个人空间', '#second');
  await tick();
  assert.equal(queue.jobs[1].state, 'queued');
  unsub();
  queue.subscribe(() => {});
  release();
  await tick();
  assert.deepEqual(names, ['one', 'one (1)']);
  assert.ok(queue.jobs.every((j) => j.state === 'done'));
  queue.dispose();
});

test('permission revocation stops current and queued files without reporting completion', async () => {
  let calls = 0;
  const queue = new UploadQueue(
    transport({
      upload: async () => {
        calls++;
        throw new IdentityError('MATERIAL_READ_ONLY', 403);
      },
    }),
  );
  queue.add(destination, scanned([file('one'), file('two')]), '个人空间', '#first');
  queue.add(destination, scanned([file('three')]), '个人空间', '#second');
  await tick();
  assert.equal(calls, 1);
  assert.ok(queue.jobs.every((j) => j.state === 'paused'));
  assert.equal(queue.jobs[0].run.files[0].state, 'failed');
  queue.dispose();
});

test('account or tenant disposal aborts in-flight work and clears all file references', async () => {
  let release!: () => void,
    calls = 0,
    signal: AbortSignal | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = new UploadQueue(
    transport({
      upload: async (_t, _w, _b, f, _d, s) => {
        calls++;
        signal = s;
        await held;
        return receipt(f.name);
      },
    }),
  );
  queue.add(destination, scanned([file('one'), file('two')]), '个人空间', '#first');
  queue.add(destination, scanned([file('three')]), '个人空间', '#second');
  await tick();
  queue.dispose();
  release();
  await tick();
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 1);
  assert.equal(queue.jobs.length, 0);
});
