import test from 'node:test';
import assert from 'node:assert/strict';
import { editorialEvidence, relocatedLegacyNote } from '../src/briefing-live/editorial-evidence.ts';
import type { BriefingDocument } from '../contracts/public-api/briefing-content';

test('only the approved legacy paragraph moves; business limits, source and original artifact stay intact', () => {
  const document = {
    content: {
      analysis: ['这3笔收款对应的会员仍需核对。', relocatedLegacyNote, '财务确认不代表银行到账。'],
      presentation: {
        version: 'briefing-presentation-v1',
        layout: 'EDITORIAL',
        sections: [
          { role: 'OBSERVATION', paragraphIndex: 0 },
          { role: 'CAUTION', paragraphIndex: 1 },
          { role: 'ACTION', paragraphIndex: 2 },
        ],
      },
      source: { versionId: 'original' },
    },
  } as BriefingDocument;
  const original = structuredClone(document);
  const result = editorialEvidence(document);
  assert.deepEqual(result.notes, [relocatedLegacyNote]);
  assert.deepEqual(result.document.content.analysis, [
    document.content.analysis[0],
    document.content.analysis[2],
  ]);
  assert.deepEqual(
    result.document.content.presentation?.sections.map((s) => s.paragraphIndex),
    [0, 1],
  );
  assert.deepEqual(document, original);
  assert.equal(result.document.content.source, document.content.source);
  assert.deepEqual(editorialEvidence(result.document).notes, []);
});
