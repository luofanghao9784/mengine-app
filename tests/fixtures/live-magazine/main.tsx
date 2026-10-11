/** Presentation fixture only: synthetic data, no session, API or model calls. */
import { useContext, useState, type ComponentProps } from 'react';
import { FollowGrid, FollowInteraction } from '../../../src/briefing-live/FollowGrid';
import type { FollowPreference } from '../../../src/components/useBriefingFollowLayout';
import { createRoot } from 'react-dom/client';
import type { BriefingDocument } from '../../../contracts/public-api/briefing-content';
import { MagazineBody } from '../../../src/briefing-live/Magazine';
import { DataBriefing } from '../../../src/briefing-live/DataBriefing';
import { MagazineGrid } from '../../../src/briefing-live/MagazineGrid';
import { SessionProvider } from '../../../src/identity/session';
import { ReadingDialog } from '../../../src/briefing-live/ReadingDialog';
import '../../../src/styles.css';
import '../../../src/briefing-live/briefing.css';
import '../../../src/recommendation/recommendation.css';
import '../../../src/identity/workspace-theme.css';

const chart: NonNullable<BriefingDocument['content']['chart']> = {
  type: 'GROUPED_BAR',
  metric: '合成收款',
  unit: '元',
  baseline: '2026-08',
  current: '2026-09',
  range: '两期各 1—23 日',
  rows: Array.from({ length: 5 }, (_, i) => ({
    group: `合成门店${i + 1}`,
    baseline: '1000',
    current: '600',
    difference: '-400',
    changePercent: '-40',
    baselineRank: 1,
    currentRank: 1,
    issue: null,
  })),
  totals: {
    group: null,
    baseline: '5000',
    current: '3000',
    difference: '-2000',
    changePercent: '-40',
    baselineRank: null,
    currentRank: null,
    issue: null,
  },
};
const documents: BriefingDocument[] = (['DATA', 'INSIGHT', 'INFO', 'SUGGESTION', 'RESULT'] as const).map(
  (businessType, i) => ({
    artifactId: `fixture-${i}`,
    sha256: 'a'.repeat(64),
    content: {
      schemaVersion: i ? 'briefing-text-v1' : 'briefing-data-v1',
      businessType,
      title: [
        '五店两期收款对比分析',
        '部分收款仍待复核，先核对统计范围与处理进度',
        '本周行业资料，已经准备就绪',
        '把需要核实的事项整理到同一页',
        '本周经营分析，已形成可审阅的成果',
      ][i],
      summary:
        '这是合成资料，用来验证真实画报的封面设计。摘要与标题分层显示，完整分析和统计依据保留在阅读详情中。',
      analysis: ['这段合成分析用于验证阅读详情完整保留正文。', '此处只检查展示，不执行业务或调用真实模型。'],
      chart: i ? null : chart,
      source: null,
      calculationArtifactId: null,
      calculationSha256: null,
      generatedAt: '2026-10-01T03:30:00Z',
    },
  }),
);
const edge: BriefingDocument = structuredClone(documents[0]);
edge.content.title = '负数、缺失值、长分组名和较多分组';
edge.content.chart!.rows = Array.from({ length: 8 }, (_, i) => ({
  ...chart.rows[0],
  group: i ? `合成分组${i + 1}` : '较长的门店名称应完整换行而不覆盖数据',
  baseline: i === 0 ? '-1000' : '1000',
  current: i === 0 ? null : '600',
  ...(i === 0
    ? {
        difference: null,
        changePercent: null,
        baselineRank: 8,
        currentRank: null,
        issue: 'MISSING_PERIOD' as const,
      }
    : {}),
}));
edge.content.chart!.totals = {
  group: null,
  baseline: null,
  current: null,
  difference: null,
  changePercent: null,
  baselineRank: null,
  currentRank: null,
  issue: 'UNEQUAL_GROUP_COVERAGE',
};
const longTitle = structuredClone(documents[1]);
longTitle.content.title =
  '这是一张合成长标题卡片，用于验证页面收窄后仍能完整显示标题并按网格标准尺寸重新排列；所有正文与摘要保持原有含义，不在前端自动改写。';
documents.push(longTitle);
documents.push(edge);

if (location.search.includes('expressive')) {
  documents.splice(0);
  for (const chartStyle of ['GROUPED_BAR', 'DUMBBELL', 'DELTA_BAR', 'CURRENT_BAR', 'TABLE'] as const) {
    const doc = structuredClone(edge);
    doc.content.title = '合成核验对比 · ' + chartStyle;
    doc.content.chart!.rows[1].current = '1000';
    doc.content.chart!.rows[1].difference = '0';
    doc.content.presentation = {
      version: 'briefing-presentation-v1',
      layout: 'EDITORIAL',
      chartStyle,
      focusGroup: null,
      focusValue: null,
      sections: [],
    };
    documents.push(doc);
  }
  const metric = structuredClone(documents[1]);
  metric.content.title = '合成重点数字 · 精确单位换算';
  metric.content.chart!.unit = '分';
  metric.content.chart!.rows[2].current = '309100';
  metric.content.presentation = {
    version: 'briefing-presentation-v1',
    layout: 'KEY_METRIC',
    chartStyle: 'DUMBBELL',
    focusGroup: metric.content.chart!.rows[2].group,
    focusValue: 'CURRENT',
    sections: [],
  };
  documents.push(metric);
  for (const layout of ['EDITORIAL', 'STEPS', 'COMPARISON', 'SOURCE'] as const) {
    const doc: BriefingDocument = {
      ...structuredClone(metric),
      content: {
        ...structuredClone(metric.content),
        businessType: layout === 'STEPS' ? 'SUGGESTION' : layout === 'SOURCE' ? 'RESULT' : 'INSIGHT',
        chart: null,
        title: '合成内容组合 · ' + layout,
        source: {
          id: 'fixture',
          materialId: 'fixture',
          versionId: 'fixture',
          version: 2,
          filename: '合成分析依据.pdf',
          sha256: 'a'.repeat(64),
          scopeExcerpt: '合成资料，仅用于检查视觉。',
        },
        presentation: {
          version: 'briefing-presentation-v1',
          layout,
          chartStyle: null,
          focusGroup: null,
          focusValue: null,
          sections:
            layout === 'SOURCE'
              ? []
              : [
                  {
                    role: layout === 'STEPS' ? 'ACTION' : layout === 'COMPARISON' ? 'OPTION' : 'OBSERVATION',
                    paragraphIndex: 0,
                  },
                  {
                    role:
                      layout === 'STEPS' ? 'CAUTION' : layout === 'COMPARISON' ? 'OPTION' : 'INTERPRETATION',
                    paragraphIndex: 1,
                  },
                ],
        },
      },
    };
    documents.push(doc);
  }
}

// Card-face graphics with varied synthetic values, shown under the workspace theme.
if (location.search.includes('faces')) {
  document.documentElement.dataset.surface = 'workspace';
  documents.splice(0);
  const row = (group: string, baseline: string | null, current: string | null, rank: number) => {
    const both = baseline !== null && current !== null;
    const difference = both ? String(Number(current) - Number(baseline)) : null;
    return {
      group,
      baseline,
      current,
      difference,
      changePercent:
        both && Number(baseline) > 0
          ? ((Number(difference) / Number(baseline)) * 100).toFixed(1).replace(/\.0$/, '')
          : null,
      baselineRank: baseline === null ? null : rank,
      currentRank: current === null ? null : rank,
      issue: both ? null : ('MISSING_PERIOD' as const),
    };
  };
  const face = (
    title: string,
    labels: [string, string],
    rows: ReturnType<typeof row>[],
    presentation: Partial<NonNullable<BriefingDocument['content']['presentation']>> = {},
    summary = false,
  ): BriefingDocument => {
    const doc = structuredClone(edge);
    doc.content.title = title;
    doc.content.chart = {
      ...chart,
      metric: summary ? '记录数' : '合成收款',
      unit: summary ? '条' : '元',
      baseline: labels[0],
      current: labels[1],
      range: summary ? '全部快照' : '两期各 1—30 日',
      rows,
      totals: { ...chart.totals, baseline: null, current: null, difference: null, changePercent: null },
    };
    doc.content.presentation = {
      version: 'briefing-presentation-v1',
      layout: 'EDITORIAL',
      chartStyle: 'GROUPED_BAR',
      focusGroup: null,
      focusValue: null,
      sections: [],
      ...presentation,
    };
    if (summary)
      Object.assign(doc.content, {
        schemaVersion: 'briefing-dataset-v1',
        datasetBasis: {
          groupColumn: '状态',
          periodColumn: '状态',
          matchedRows: 398,
          ignoredRows: 0,
          periodMode: 'SUMMARY',
        },
      });
    return doc;
  };
  const stores = [
    row('合成门店甲', '82400', '91200', 1),
    row('合成门店乙', '76900', '64300', 2),
    row('合成门店丙', '58200', '73500', 3),
    row('合成门店丁', '44600', '38900', 4),
    row('合成门店戊', null, '47400', 5),
  ];
  documents.push(
    face('两店上升两店回落，门店丙涨幅最大', ['2026-08', '2026-09'], stores),
    face(
      '在读课程占三分之二，请假与冻结合计两成',
      ['', '本次汇总'],
      [
        ['在读', '268'],
        ['请假', '52'],
        ['冻结', '31'],
        ['已结课', '22'],
        ['已退课', '14'],
        ['已取消', '11'],
      ].map(([group, value], i) => row(group, null, value, i + 1)),
      { chartStyle: 'CURRENT_BAR' },
      true,
    ),
    face(
      '门店乙已取消定金最多，占其定金的一成六',
      ['已取消', '财务已确认'],
      [
        row('合成门店乙', '12700', '65900', 1),
        row('合成门店丁', '7900', '64800', 2),
        row('合成门店甲', '4100', '176200', 3),
        row('合成门店戊', '2600', '73400', 4),
        row('合成门店丙', null, '109800', 5),
      ],
    ),
    face('九月收款较八月的增减，门店丙增加最多', ['2026-08', '2026-09'], stores, {
      chartStyle: 'DELTA_BAR',
    }),
    face('门店丙九月收款 73,500 元', ['2026-08', '2026-09'], stores, {
      layout: 'KEY_METRIC',
      focusGroup: '合成门店丙',
      focusValue: 'CURRENT',
    }),
  );
  documents[2].content.chart!.range = '全部快照 · 210 行';
}

if (location.search.includes('labels')) {
  const doc=structuredClone(documents[0]);
  doc.content.title='合成状态显示核对';
  doc.content.chart!.baseline='finance_confirmed';doc.content.chart!.current='canceled';
  doc.content.chart!.rows[0].group='active';doc.content.chart!.rows[1].group='unknown_status';
  doc.chartLabels={groups:{active:'开课中'},columns:{finance_confirmed:'财务已确认',canceled:'已取消'}};
  doc.content.presentation={version:'briefing-presentation-v1',layout:'KEY_METRIC',chartStyle:'GROUPED_BAR',focusGroup:'active',focusValue:'CURRENT',sections:[]};
  documents.splice(0,documents.length,doc);
}

function FixtureGrid({ items }: ComponentProps<typeof MagazineGrid>) {
  const [saved, setSaved] = useState<FollowPreference | undefined>(
    () => JSON.parse(sessionStorage.getItem('fixture-follow') || 'null') || undefined,
  );
  const [, setArranging] = useState(false);
  return location.search.includes('follow') ? (
    <FollowGrid
      items={items}
      saved={saved}
      owner="fixture"
      blocked={false}
      onArranging={setArranging}
      onSave={(value) => {
        setSaved(value);
        sessionStorage.setItem('fixture-follow', JSON.stringify(value || null));
      }}
    />
  ) : (
    <MagazineGrid items={items} />
  );
}
function ReadButton({ onClick, ...props }: ComponentProps<'button'>) {
  const follow = useContext(FollowInteraction);
  return (
    <button
      {...props}
      onPointerDown={follow?.onPointerDown}
      onKeyDown={follow?.onKeyDown}
      onClick={(event) => {
        if (!follow?.editing) onClick?.(event);
      }}
    />
  );
}
function Fixture() {
  const [reading, setReading] = useState<BriefingDocument>();
  return (
    <main className="live-briefing" style={{ padding: 24 }}>
      <h1 style={{ fontSize: 16 }}>画报卡面 · 合成视觉验证</h1>
      <FixtureGrid
        items={documents.map((briefing, i) => ({
          id: `fixture-${i}`,
          title: briefing.content.title,
          summary: briefing.content.summary,
          chart: !!briefing.content.chart,
          render: (
            <article className={`live-briefing-card recommendation-card${i === 1 ? ' is-read' : ''}`}>
              <ReadButton
                className="live-briefing-body"
                onClick={() => setReading(briefing)}
                aria-label={`阅读：${briefing.content.title}`}
              >
                <MagazineBody
                  title={briefing.content.title}
                  excerpt=""
                  truncated={false}
                  workspace="合成工作空间"
                  date={briefing.content.generatedAt}
                  briefing={briefing}
                  pinned={i === 1}
                />
              </ReadButton>
            </article>
          ),
        }))}
      />
      {reading && (
        <SessionProvider>
          <ReadingDialog
            title={reading.content.title}
            workspace="合成工作空间"
            date={reading.content.generatedAt}
            tenant="fixture"
            onClose={() => setReading(undefined)}
            contentLabel="数据"
          >
            <DataBriefing document={reading} />
          </ReadingDialog>
        </SessionProvider>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
