import type { CardConfig, CardData } from '../briefing';
import type { BriefingPresentation } from '../briefingPresentation';
import { briefingDocuments, briefingPeople } from '../briefingMedia';
import { useDemo } from '../store';
import { BriefingDocumentCovers } from './BriefingMedia';
import { BriefingChart } from './BriefingChart';

export function BriefingDesignedBody({
  data,
  config,
  at,
  presentation: p,
}: {
  data: CardData;
  config: CardConfig;
  at: string;
  presentation: BriefingPresentation;
}) {
  const { state } = useDemo();
  const people = briefingPeople(state, data),
    documents = briefingDocuments(state, data);
  const tall = config.size.endsWith('2') && !config.compact,
    wide = config.size.startsWith('2');
  const points = p.points || data.items?.map((d) => ({ label: d.label, text: d.value }));
  const editorial = ['brief', 'digest'].includes(p.format);
  const shortComparison = p.format === 'comparison' && !tall;
  const showCover =
    documents.length > 0 &&
    !editorial &&
    !shortComparison &&
    (p.format === 'document' || tall || (wide && !p.chart));
  const showPoints =
    !p.chart &&
    !!points?.length &&
    (tall ||
      (p.format === 'comparison' && wide) ||
      p.format === 'digest' ||
      (p.format === 'brief' && !!p.points));
  const mainAdvice = p.format === 'recommendation';
  return (
    <div
      className={`briefing-designed design-${p.format}${showCover ? ' has-covers' : ''}${p.chart ? ' has-chart' : ''}`}
      data-format={p.format}
    >
      <div className="briefing-card-eyebrow">
        <span className="briefing-card-meta">
          <span>{p.kicker || data.type}</span>
          <time dateTime={at}>
            {new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </time>
        </span>
        {people.length > 0 && (
          <span
            className="briefing-people-placeholder"
            aria-hidden="true"
            style={{ width: Math.min(people.length, 4) * 19 + 9 }}
          />
        )}
      </div>
      <h3>{config.title}</h3>
      <div className="briefing-designed-main">
        <div className="briefing-designed-copy">
          {mainAdvice ? (
            <>
              <p className="briefing-primary-advice">{p.lead || data.advice}</p>
              <p className="briefing-evidence">{data.fact}</p>
            </>
          ) : (
            <p className="briefing-evidence">{shortComparison ? data.advice : data.fact}</p>
          )}
          {p.chart && <BriefingChart chart={p.chart} spacious={tall} />}
          {showPoints && (
            <div className="briefing-reasoning">
              {points!.slice(0, 3).map((point) => (
                <div key={point.label}>
                  <strong>{point.label}</strong>
                  {!shortComparison && <p>{point.text}</p>}
                </div>
              ))}
            </div>
          )}
          {!p.chart && !mainAdvice && data.value && (
            <div className="briefing-designed-number">
              <strong>{data.value}</strong>
              <span>{data.unit}</span>
            </div>
          )}
          {!mainAdvice &&
            !shortComparison &&
            data.advice &&
            (tall || p.format === 'insight' || p.format === 'document') && (
              <p className="briefing-takeaway">{data.advice}</p>
            )}
        </div>
        {showCover && (
          <div className="briefing-designed-files">
            <BriefingDocumentCovers documents={documents} />
          </div>
        )}
      </div>
      <div className="briefing-designed-footer">
        {!showCover && documents.length > 0 && (
          <span className="briefing-file-summary" title={documents.map((d) => d.title).join('、')}>
            依据 {documents.length} 份资料
          </span>
        )}
        <small className="briefing-source" title={data.source}>
          {data.source}
        </small>
      </div>
    </div>
  );
}
