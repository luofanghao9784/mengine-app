import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyEditorialLayout, isInternalBriefingArtifact } from '../src/briefing-live/editorial-policy.ts';
import { pendingReceipts } from '../src/briefing-live/pending-receipts.ts';
import type { BriefingDocument } from '../contracts/public-api/briefing-content';

test('known technical files are archived; user JSON and downloadable documents remain attachments', () => {
  for (const name of ['briefing-chain.json', 'briefing-dataset-v1.json', 'business-plan.json', 'chain-calculation.json']) assert.equal(isInternalBriefingArtifact(name), true);
  for (const name of ['客户清单.json', '分析结果.xlsx', 'briefing-notes.pdf', 'business-plan.pdf']) assert.equal(isInternalBriefingArtifact(name), false);
});
test('legacy sizes do not silently reclassify new recommendations', () => {
  assert.equal(legacyEditorialLayout('万象汇这笔退款，先补证再汇报'), '1×2');
  assert.equal(legacyEditorialLayout('荔星3笔收款，按这两步接续复核'), '2×1');
  assert.equal(legacyEditorialLayout('另一张退款建议'), undefined);
});
test('pending summary derives only the approved exclusive groups and refuses unknown or missing values', () => {
  const document = { content: { title: '梵华里41笔已复核，4笔分两步接续', chart: { rows: [
    { group: '财务已确认', current: '41' }, { group: '待财务审核', current: '3' }, { group: '已确认待补凭证', current: '1' },
  ] } } } as BriefingDocument;
  assert.deepEqual(pendingReceipts(document), { confirmed:41, review:3, receipt:1, total:4 });
  const copy = structuredClone(document);
  copy.content.title = '其他收款状态'; assert.equal(pendingReceipts(copy), null);
  copy.content.title = document.content.title;
  copy.content.chart!.rows[1].current = null; assert.equal(pendingReceipts(copy), null);
  copy.content.chart!.rows[1].current = '3'; copy.content.chart!.rows[2].group = '可能重叠的状态'; assert.equal(pendingReceipts(copy), null);
});
