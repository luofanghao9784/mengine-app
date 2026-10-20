import test from 'node:test';
import assert from 'node:assert/strict';
import { isBriefingDocument, formatBriefingNumber } from '../src/briefing-live/content.ts';
import { readFileSync } from 'node:fs';
test('dataset briefing binds the snapshot and distinguishes absent business coverage from collection time', () => {
  const dataset = JSON.parse(
    readFileSync(new URL('../contracts/fixtures/dataset-briefing.json', import.meta.url), 'utf8'),
  );
  assert.ok(isBriefingDocument(dataset));
  for (const bad of [
    { snapshotId: 'latest' },
    { rowCount: -1 },
    { coverageThrough: undefined },
    { collectedAt: 'unknown' },
  ]) {
    const changed = structuredClone(dataset);
    Object.assign(changed.content.datasetSource, bad);
    assert.equal(isBriefingDocument(changed), false);
  }
  const changed = structuredClone(dataset);
  changed.content.schemaVersion = 'briefing-data-v1';
  assert.equal(isBriefingDocument(changed), false);
  for (const basis of [
    undefined,
    null,
    { ...dataset.content.datasetBasis, matchedRows: 4 },
    { ...dataset.content.datasetBasis, ignoredRows: -1 },
    { ...dataset.content.datasetBasis, groupColumn: '' },
  ]) {
    const changed = structuredClone(dataset);
    changed.content.datasetBasis = basis;
    assert.equal(isBriefingDocument(changed), false);
  }
});
const id = '00000000-0000-4000-8000-000000000001';
const row = {
  group: '甲',
  baseline: '0.30',
  current: '0.60',
  difference: '0.30',
  changePercent: '100.00',
  baselineRank: 2,
  currentRank: 1,
  issue: null,
};
const doc = {
  artifactId: id,
  sha256: 'a'.repeat(64),
  content: {
    schemaVersion: 'briefing-data-v1',
    businessType: 'DATA',
    title: '测试独立画报',
    summary: '两期门店数据对比结果用于合成测试。',
    analysis: ['测试分析一需要保留完整的数据统计口径。', '测试分析二需要区分推断和已有数据证据。'],
    chart: {
      type: 'GROUPED_BAR',
      metric: '收款（元）',
      unit: '元',
      baseline: '前期',
      current: '本期',
      range: 'A1:C6',
      rows: [row],
      totals: { ...row, group: null },
    },
    source: {
      id,
      materialId: id,
      versionId: id,
      version: 1,
      filename: '合成.xlsx',
      sha256: 'b'.repeat(64),
      scopeExcerpt: '合成同口径测试。',
    },
    calculationArtifactId: id,
    calculationSha256: 'c'.repeat(64),
    generatedAt: '2026-10-01T00:00:00Z',
  },
};
test('independent briefing requires bound source, real decimal strings and complete prose', () => {
  assert.ok(isBriefingDocument(doc));
  for (const mutation of [
    () => {
      doc.content.chart.rows[0].current = 'NaN';
    },
    () => {
      doc.content.source.sha256 = 'fake';
    },
    () => {
      doc.content.analysis = [];
    },
  ]) {
    const original = structuredClone(doc);
    mutation();
    assert.equal(isBriefingDocument(doc), false);
    Object.assign(doc, original);
  }
  const absent = structuredClone(doc);
  Object.assign(absent.content.chart.rows[0], {
    baseline: null,
    difference: null,
    changePercent: null,
    baselineRank: null,
    issue: 'MISSING_PERIOD',
  });
  assert.ok(isBriefingDocument(absent));
});
test('chart labels preserve exact decimals and missing is never zero', () => {
  assert.equal(formatBriefingNumber('12345678901234567890.30'), '12,345,678,901,234,567,890.30');
  assert.equal(formatBriefingNumber('-14255.00'), '-14,255.00');
  assert.equal(formatBriefingNumber(null), '缺数据');
  assert.equal(formatBriefingNumber('0.00'), '0.00');
});

test('text insight may cite a dataset snapshot without claiming a calculation', () => {
  const doc = JSON.parse(
    readFileSync(new URL('../contracts/fixtures/dataset-briefing.json', import.meta.url), 'utf8'),
  );
  Object.assign(doc.content, {
    schemaVersion: 'briefing-text-v1',
    businessType: 'INSIGHT',
    chart: null,
    calculationArtifactId: null,
    calculationSha256: null,
    datasetBasis: null,
  });
  assert.ok(isBriefingDocument(doc));
  doc.content.datasetSource.snapshotId = 'latest';
  assert.equal(isBriefingDocument(doc), false);
});

test('rule version provenance validates metadata and keeps legacy cards readable',()=>{
 const doc=JSON.parse(readFileSync(new URL('../contracts/fixtures/dataset-briefing.json',import.meta.url),'utf8'));assert.ok(isBriefingDocument(doc));doc.ruleTrace={status:'RECORDED',versions:[{source:'GLOBAL',target:'BRIEFING',revision:1}]};assert.ok(isBriefingDocument(doc));doc.ruleTrace.versions[0].revision=0;assert.equal(isBriefingDocument(doc),false);doc.ruleTrace={status:'NOT_RECORDED',versions:[]};assert.ok(isBriefingDocument(doc));
});

test('summary evidence accepts a single series without invented baseline or growth', () => {
  const value = JSON.parse(readFileSync(new URL('../contracts/fixtures/dataset-briefing.json', import.meta.url), 'utf8'));
  value.content.datasetBasis.periodMode = 'SUMMARY';
  value.content.datasetBasis.periodColumn = '不适用';
  value.content.chart.baseline = '不适用';
  value.content.chart.current = '本次汇总';
  for (const row of [...value.content.chart.rows, value.content.chart.totals]) {
    row.baseline = row.difference = row.changePercent = row.baselineRank = row.currentRank = row.issue = null;
  }
  value.content.presentation = {version:'briefing-presentation-v1',layout:'EDITORIAL',chartStyle:'CURRENT_BAR',focusGroup:null,focusValue:null,sections:[]};
  assert.ok(isBriefingDocument(value));
});

test('chain chart accepts bounded multi-store rows without pretending to be a single-source table',()=>{
 const c=structuredClone(doc) as any;c.content.schemaVersion='briefing-chain-v1';c.content.source=null;const r=structuredClone(c.content.chart.rows[0]);
 c.content.chart.rows=[r,{...r,group:'乙'}];assert.ok(isBriefingDocument(c));
 c.content.chart.rows=[r];assert.equal(isBriefingDocument(c),false);
 c.content.chart.rows=[r,{...r,group:'乙'}];c.content.schemaVersion='briefing-data-v1';assert.equal(isBriefingDocument(c),false);
});
