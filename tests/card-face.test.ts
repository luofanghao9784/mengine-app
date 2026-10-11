import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  faceKind,
  hasPlottableValues,
  isPeriodLabel,
  leadRow,
  rankedRows,
  signedText,
  slopeEligible,
  sortedRows,
} from '../src/briefing-live/card-face.ts';
import type { BriefingDocument, BriefingRow } from '../contracts/public-api/briefing-content';

const dataset: BriefingDocument = JSON.parse(
  readFileSync(new URL('../contracts/fixtures/dataset-briefing.json', import.meta.url), 'utf8'),
);
const row = (group: string, baseline: string | null, current: string | null, changePercent: string | null) =>
  ({
    group,
    baseline,
    current,
    difference: null,
    changePercent,
    baselineRank: null,
    currentRank: null,
    issue: null,
  }) satisfies BriefingRow;
const withChart = (change: (doc: BriefingDocument) => void) => {
  const doc = structuredClone(dataset);
  doc.content.presentation = null;
  change(doc);
  return doc;
};

test('a slope is drawn only between two period labels, never between two categories', () => {
  for (const label of ['2026-08', '2026/8', '2026年9月', '9月', '2026-09-30', '2026 Q3', '上月', '本期'])
    assert.equal(isPeriodLabel(label), true, label);
  for (const label of ['finance_confirmed', 'canceled', '已取消', '门店甲', '', '2026-08 定金'])
    assert.equal(isPeriodLabel(label), false, label);
});

test('card-face form follows the verified calculation and the chosen chart style', () => {
  const periods = (doc: BriefingDocument) => {
    doc.content.datasetBasis!.periodMode = 'EXACT';
    doc.content.chart!.baseline = '2026-08';
    doc.content.chart!.current = '2026-09';
    doc.content.chart!.rows = [row('甲', '1', '2', '100'), row('乙', '2', '1', '-50')];
  };
  assert.equal(faceKind(withChart(periods)), 'SLOPE');
  assert.equal(
    faceKind(
      withChart((doc) => {
        periods(doc);
        doc.content.chart!.current = 'finance_confirmed';
      }),
    ),
    'PAIR',
  );
  assert.equal(
    faceKind(
      withChart((doc) => {
        periods(doc);
        doc.content.chart!.rows = Array.from({ length: 7 }, (_, i) => row(`组${i}`, '1', '2', '100'));
      }),
    ),
    'PAIR',
  );
  assert.equal(
    faceKind(
      withChart((doc) => {
        periods(doc);
        doc.content.datasetBasis!.periodMode = 'SUMMARY';
      }),
    ),
    'RANK',
  );
  const styled = (chartStyle: NonNullable<BriefingDocument['content']['presentation']>['chartStyle']) =>
    faceKind(
      withChart((doc) => {
        periods(doc);
        doc.content.presentation = {
          version: 'briefing-presentation-v1',
          layout: 'EDITORIAL',
          chartStyle,
          focusGroup: null,
          focusValue: null,
          sections: [],
        };
      }),
    );
  assert.equal(styled('TABLE'), 'TABLE');
  assert.equal(styled('CURRENT_BAR'), 'RANK');
  assert.equal(styled('DELTA_BAR'), 'DELTA');
  assert.equal(styled('DUMBBELL'), 'SLOPE');
  assert.equal(faceKind(withChart((doc) => (doc.content.chart = null))), null);
});

test('the lead group is the largest verified rate of change and ignores groups without one', () => {
  const rows = [
    row('甲', '100', '110', '10'),
    row('乙', '100', '70', '-30'),
    row('丙', null, '50', null),
    row('丁', '100', '130', '30'),
  ];
  assert.equal(leadRow(rows)?.group, '乙');
  assert.equal(leadRow([row('丙', null, '50', null)]), null);
  // Exact decimal ordering beyond the JS safe integer range.
  assert.equal(
    leadRow([row('小', '1', '2', '9007199254740993'), row('大', '1', '2', '-9007199254740995')])?.group,
    '大',
  );
});

test('ranking puts missing values last and signed text never recomputes the value', () => {
  assert.deepEqual(
    rankedRows([row('缺', '1', null, null), row('低', '1', '5', null), row('高', '1', '20', null)]).map(
      (r) => r.group,
    ),
    ['高', '低', '缺'],
  );
  assert.equal(signedText('26.3'), '+26.3');
  assert.equal(signedText('-16.4'), '-16.4');
  assert.equal(signedText('0'), '0');
  assert.equal(signedText('0.0'), '0.0');
});

test('the full reading offers a slope only for two periods, few groups and a real comparison', () => {
  const periods = withChart((doc) => {
    doc.content.datasetBasis!.periodMode = 'EXACT';
    doc.content.chart!.baseline = '2026-08';
    doc.content.chart!.current = '2026-09';
    doc.content.chart!.rows = [row('甲', '1', '2', '100')];
  });
  assert.equal(slopeEligible(periods), true);
  const summary = structuredClone(periods);
  summary.content.datasetBasis!.periodMode = 'SUMMARY';
  assert.equal(slopeEligible(summary), false);
  const categories = structuredClone(periods);
  categories.content.chart!.baseline = 'canceled';
  assert.equal(slopeEligible(categories), false);
  // A month-bucketed calculation is a period comparison whatever its labels look like.
  categories.content.datasetBasis!.periodMode = 'MONTH';
  assert.equal(slopeEligible(categories), true);
});

test('a chart of only zeros and gaps is reported as having nothing to plot', () => {
  assert.equal(hasPlottableValues([row('甲', '0', null, null), row('乙', null, '0.00', null)]), false);
  assert.equal(hasPlottableValues([row('甲', '0', null, null), row('乙', null, '-0.01', null)]), true);
  assert.equal(hasPlottableValues([]), false);
});

test('reader-chosen order keeps the source order by default and sinks missing values', () => {
  const delta = (group: string, current: string | null, difference: string | null) => ({
    ...row(group, '1', current, null),
    difference,
  });
  const rows = [
    delta('甲', '5', '-3'),
    delta('乙', null, null),
    delta('丙', '9', '4'),
    delta('丁', '7', '-8'),
  ];
  assert.equal(sortedRows(rows, 'SOURCE'), rows);
  assert.deepEqual(
    sortedRows(rows, 'CURRENT').map((r) => r.group),
    ['丙', '丁', '甲', '乙'],
  );
  assert.deepEqual(
    sortedRows(rows, 'CHANGE').map((r) => r.group),
    ['丙', '甲', '丁', '乙'],
  );
  assert.deepEqual(
    rows.map((r) => r.group),
    ['甲', '乙', '丙', '丁'],
  );
});
