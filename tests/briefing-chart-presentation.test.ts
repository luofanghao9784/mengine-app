import test from 'node:test';
import assert from 'node:assert/strict';
import type { BriefingDocument } from '../contracts/public-api/briefing-content';
import { toMagazineChart } from '../src/briefing-live/chart-presentation.ts';
import { chartDescription } from '../src/briefingPresentation.ts';

const document: BriefingDocument = {
  artifactId: 'fixture',
  sha256: 'a'.repeat(64),
  content: {
    schemaVersion: 'briefing-data-v1',
    businessType: 'DATA',
    title: '合成比较',
    summary: '仅用于展示投影测试',
    analysis: [],
    source: null,
    calculationArtifactId: null,
    calculationSha256: null,
    generatedAt: '2026-10-01T00:00:00Z',
    chart: {
      type: 'GROUPED_BAR',
      metric: '收款',
      unit: '元',
      baseline: '8月',
      current: '9月',
      range: '两期各1—23日',
      rows: [],
      totals: {
        group: null,
        baseline: null,
        current: null,
        difference: null,
        changePercent: null,
        baselineRank: null,
        currentRank: null,
        issue: null,
      },
    },
  },
};
const row = (group: string, baseline: string | null, current: string | null) => ({
  group,
  baseline,
  current,
  difference: null,
  changePercent: null,
  baselineRank: null,
  currentRank: null,
  issue: null,
});

test('shared Demo chart preserves missing, negative, zero and exact decimal labels', () => {
  const source = structuredClone(document);
  source.content.chart!.rows = [
    row('缺失', '-1000.00', null),
    row('零', '0.00', '0.00'),
    row('精确', '12345678901234567890.30', '0.123456789012'),
  ];
  const before = structuredClone(source);
  const chart = toMagazineChart(source)!;
  assert.equal(chart.kind, 'columns');
  assert.equal(chart.rows[0].valueMissing, true);
  assert.equal(chart.rows[0].previous, -1000);
  assert.equal(chart.rows[1].valueMissing, false);
  assert.equal(chart.rows[1].valueText, '0.00');
  assert.equal(chart.rows[2].previousText, '12,345,678,901,234,567,890.30');
  assert.equal(chart.rows[2].valueText, '0.123456789012');
  assert.match(chartDescription(chart), /缺失 -1,000.00 → 缺数据元/);
  assert.deepEqual(source, before);
});

test('cover explicitly identifies its six-group preview while detail retains every group', () => {
  const source = structuredClone(document);
  source.content.chart!.rows = Array.from({ length: 50 }, (_, i) =>
    row('分组' + i, String(i), String(i + 1)),
  );
  const preview = toMagazineChart(source, true)!;
  assert.equal(preview.rows.length, 6);
  assert.match(preview.period, /前6组 \/ 共50组/);
  assert.equal(toMagazineChart(source)!.rows.length, 50);
  assert.equal(toMagazineChart(source)!.rows[49].label, '分组49');
  source.content.chart = null;
  assert.equal(toMagazineChart(source), null);
});

test('spreadsheet coordinates stay in source evidence rather than becoming a statistical period', () => {
  const source = structuredClone(document);
  source.content.chart!.range = 'Sheet1!$A$1:$F$16';
  assert.equal(toMagazineChart(source)!.period, '两期对比');
  assert.equal(source.content.chart!.range, 'Sheet1!$A$1:$F$16');
});
