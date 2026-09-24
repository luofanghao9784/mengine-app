// Explicit public-network check. Fixed public query and synthetic data; no cloud model or credentials.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { CandidateSession, NpmCandidates } from '../dist/runtime/candidate-tools.js';
import { LocalNodeSandbox } from '../dist/runtime/sandbox.js';
class ReviewedRegistry extends NpmCandidates {
  async prepare(candidate, signal) {
    const result = await super.prepare(candidate, signal);
    assert.equal(
      result.installed.archiveSha256,
      '7e7c8f2d6d0511237ac1d9e728483d8e6c9ecf3c7e16f55e9be4a59782327442',
    );
    return result;
  }
}
const session = new CandidateSession(
  'ini',
  new ReviewedRegistry(),
  new LocalNodeSandbox({
    python: process.env.DREAMCORE_TEST_PYTHON || '/opt/homebrew/bin/python3',
  }),
);
const signal = AbortSignal.timeout(30000);
try {
  const discovered = await session.execute({ action: 'discover' }, [], signal);
  const candidate = discovered.items.find((c) => c.name === 'ini' && c.version === '7.0.0');
  assert.ok(candidate, 'Expected reviewed ini@7.0.0; registry changed, re-review before updating pin');
  const trial = await session.execute({ action: 'trial', id: candidate.id }, [], signal);
  assert.equal(trial.archiveSha256, '7e7c8f2d6d0511237ac1d9e728483d8e6c9ecf3c7e16f55e9be4a59782327442');
  assert.equal(trial.status, 'READY');
  const run = await session.execute(
    { action: 'run', id: candidate.id, inputHandle: 'synthetic.txt' },
    [{ handle: 'synthetic.txt', bytes: Buffer.from('[workspace]\nname=Dreamcore\namount=1001\n') }],
    signal,
  );
  assert.equal(run.candidate.status, 'USED');
  assert.deepEqual(JSON.parse(Buffer.from(run.artifacts[0].contentBase64, 'base64')), {
    workspace: { name: 'Dreamcore', amount: '1001' },
  });
  const report = JSON.parse(Buffer.from(session.report().contentBase64, 'base64'));
  const folder = new URL('../../.local/m4-candidates/', import.meta.url);
  await mkdir(folder, { recursive: true });
  await writeFile(
    new URL('public-result.json', folder),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        cloudModelCalled: false,
        report,
        resultSha256: run.artifacts[0].sha256,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS: public npm ini@7.0.0 archive verified, staged offline, synthetic trial passed and synthetic excerpt converted; license retained.',
  );
} finally {
  session.close();
}
