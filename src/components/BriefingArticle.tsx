import { ChevronRight, FileText } from 'lucide-react';
import { canReadCardData, type BriefingReference } from '../briefing';
import { buildBriefingArticle } from '../briefingArticle';
import { briefingPresentation } from '../briefingPresentation';
import { magazineHeadline } from '../briefingMagazine';
import { briefingSource, briefingTime } from '../briefingTypography';
import { useDemo } from '../store';
import { BriefingChart } from './BriefingChart';
import { SourceImage, SourceLinks } from './SourceDetails';

/** The same reading body is used in the popup and retained conversation cards. */
export function BriefingArticle({
  reference,
  embedded = false,
  titleId,
  onSource,
}: {
  reference: BriefingReference;
  embedded?: boolean;
  titleId?: string;
  onSource: (id: string) => void;
}) {
  const { state } = useDemo();
  const data = reference.snapshot;
  if (!canReadCardData(state, data)) return <p className="subtle">这张卡片的来源已不可访问。</p>;
  const presentation = briefingPresentation(data);
  const article = reference.article || buildBriefingArticle(data);
  const points = presentation?.points || data.items?.map((item) => ({ label: item.label, text: item.value }));
  return (
    <article className={`briefing-detail-article${embedded ? ' briefing-article-embedded' : ''}`}>
      {data.dataPeriod && (
        <p className="subtle">
          {data.sourceKind === 'news' ? '报道日期' : '统计范围'}：{data.dataPeriod}
        </p>
      )}
      {!data.reporting && (
        <time dateTime={reference.asOf}>
          {data.article ? '本次分析生成于' : '内容截至'} {briefingTime(reference.asOf, true)}
        </time>
      )}
      <h2 id={titleId}>{magazineHeadline(data, reference.config.title)}</h2>
      <SourceImage photo={data.photo} />
      <p className="briefing-detail-lead">{data.fact}</p>
      {data.value && !presentation?.chart && (
        <div className="briefing-detail-value">
          <strong>{data.value}</strong> {data.unit}
        </div>
      )}
      {presentation?.chart && (
        <div className="briefing-detail-chart">
          <BriefingChart chart={presentation.chart} spacious />
        </div>
      )}
      {presentation?.lead && presentation.lead !== data.fact && presentation.lead !== data.advice && (
        <p>{presentation.lead}</p>
      )}
      {points && (
        <dl className="briefing-detail-points">
          {points.map((point, i) => (
            <div key={i}>
              <dt>{point.label}</dt>
              <dd>{point.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {data.advice && (
        <aside className="briefing-detail-advice">
          <span>分析与建议</span>
          <p>{data.advice}</p>
        </aside>
      )}
      <div className="briefing-article-extension">
        <span className="briefing-article-eyebrow">
          {data.reporting
            ? data.sourceKind === 'news'
              ? '背景与观察'
              : '经营分析'
            : data.article
              ? '完整分析 · 本次生成'
              : '延伸解读 · 演示'}
        </span>
        {article.sections.map((section, index) => (
          <section key={index}>
            <h3>{section.heading}</h3>
            {section.paragraphs.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </section>
        ))}
      </div>
      <div className="briefing-detail-sources">
        <span>依据</span>
        <p>{briefingSource(data.source)}</p>
        <SourceLinks links={data.sourceLinks} />
        {data.refs?.map((id) => {
          const doc = state.materials.find((d) => d.id === id);
          return (
            doc && (
              <button key={id} onClick={() => onSource(id)}>
                <FileText size={15} />
                <span>{doc.title}</span>
                <ChevronRight size={15} />
              </button>
            )
          );
        })}
      </div>
    </article>
  );
}
