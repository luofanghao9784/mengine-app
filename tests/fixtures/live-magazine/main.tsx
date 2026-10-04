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
