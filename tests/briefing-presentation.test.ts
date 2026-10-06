import test from 'node:test';
import assert from 'node:assert/strict';
import type { BriefingDocument, BriefingPresentation } from '../contracts/public-api/briefing-content';
import { compareDecimal, isPresentation, presentationOf } from '../src/briefing-live/presentation.ts';
import { isBriefingDocument } from '../src/briefing-live/content.ts';
const content: BriefingDocument['content'] = {
  schemaVersion: 'briefing-text-v1',
  businessType: 'SUGGESTION',
  title: '核验业务行动建议',
  summary: '依据资料提出建议，执行前仍需核实适用范围。',
  analysis: ['核验原始记录，明确收款状态与实际业务口径。', '与相关人员核实业务条件后，再安排后续行动。'],
  chart: null,
  source: null,
  calculationArtifactId: null,
  calculationSha256: null,
  generatedAt: '2026-10-06T00:00:00Z',
};
const p: BriefingPresentation = {
  version: 'briefing-presentation-v1',
  layout: 'STEPS',
  chartStyle: null,
  focusGroup: null,
  focusValue: null,
  sections: [
    { role: 'ACTION', paragraphIndex: 0 },
    { role: 'CAUTION', paragraphIndex: 1 },
  ],
};
test('compositions reuse actual paragraphs, never create steps from an insight or duplicate evidence', () => {
  assert.equal(isPresentation(p, content), true);
  assert.equal(isPresentation(p, { ...content, businessType: 'INSIGHT' }), false);
  for (const indices of [
    [0, 0],
    [-1, 0],
    [0, 2],
    [0, 0.5],
  ])
    assert.equal(
      isPresentation(
        { ...p, sections: indices.map((paragraphIndex) => ({ role: 'ACTION', paragraphIndex })) },
        content,
      ),
      false,
    );
  assert.equal(
    isPresentation(
      {
        ...p,
        sections: [
          { role: 'OBSERVATION', paragraphIndex: 0 },
          { role: 'ACTION', paragraphIndex: 1 },
        ],
      },
      content,
    ),
    false,
  );
  assert.equal(isPresentation({ ...p, sections: [null] }, content), false);
  assert.equal(isPresentation(p, { ...content, analysis: undefined } as unknown as typeof content), false);
});
test('old cards remain readable, new malformed layouts fail the API document validator', () => {
  const doc: BriefingDocument = {
    artifactId: '00000000-0000-4000-8000-000000000001',
    sha256: 'a'.repeat(64),
    content: structuredClone(content),
  };
  assert.equal(isBriefingDocument(doc), true);
  assert.equal(presentationOf(doc), null);
  doc.content.presentation = p;
  assert.equal(isBriefingDocument(doc), true);
  assert.deepEqual(presentationOf(doc), p);
  doc.content.presentation = { ...p, chartStyle: 'TABLE' };
  assert.equal(isBriefingDocument(doc), false);
  doc.content.presentation = {
    ...p,
    sections: [{ role: '__proto__', paragraphIndex: 0 }],
  } as unknown as BriefingPresentation;
  assert.equal(isBriefingDocument(doc), false);
});
test('current-period ranking preserves decimal precision and puts missing last without changing source order', () => {
  const raw = [
    '12345678901234567890.300000000001',
    null,
    '12345678901234567890.300000000002',
    '-0.10',
    '0',
    '-0.2',
  ];
  const sorted = [...raw].sort((a, b) => compareDecimal(b, a));
  assert.deepEqual(sorted, [
    '12345678901234567890.300000000002',
    '12345678901234567890.300000000001',
    '0',
    '-0.10',
    '-0.2',
    null,
  ]);
  assert.equal(raw[0], '12345678901234567890.300000000001');
  assert.equal(compareDecimal('1.20', '1.2'), 0);
});
