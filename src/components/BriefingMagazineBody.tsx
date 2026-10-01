import { useState } from 'react';
import {
  Newspaper,
  ChartNoAxesCombined,
  Lightbulb,
  Signpost,
  FileCheck2,
  MessagesSquare,
} from 'lucide-react';
import { briefingLifecycle } from '../briefingLifecycle';
import type { CardConfig, CardData } from '../briefing';
import { magazineHeadline, magazineType, magazineView } from '../briefingMagazine';
import { briefingCardSource, briefingTime } from '../briefingTypography';
import { briefingPhoto, briefingDocuments, briefingPeople } from '../briefingMedia';
import { useDemo } from '../store';
import { BriefingChart } from './BriefingChart';
import { BriefingDocumentCovers } from './BriefingMedia';

const icons = {
  资讯: Newspaper,
  数据: ChartNoAxesCombined,
  洞察: Lightbulb,
  建议: Signpost,
  成果: FileCheck2,
  会话: MessagesSquare,
};
export function BriefingMagazineBody({
  data,
  config,
  at,
}: {
  data: CardData;
  config: CardConfig;
  at: string;
}) {
  const { state } = useDemo();
  const type = magazineType(data),
    view = magazineView(data),
    Icon = icons[type];
  const photo = view.photo || briefingPhoto(data);
  const [failedPhoto, setFailedPhoto] = useState('');
  const hasPhoto = photo && photo.src !== failedPhoto;
  const documents = type === '成果' ? briefingDocuments(state, data) : [];
  const people = briefingPeople(state, data);
  const headline = magazineHeadline(data, config.title);
  const tall = config.size.endsWith('2') && !config.compact;
  const source = briefingCardSource(data.source);
  return (
    <div
      className={`briefing-magazine magazine-${type}${data.reporting ? ' magazine-reporting' : ''}${hasPhoto ? ' magazine-with-photo' : ''}${view.chart ? ' magazine-with-chart' : ''}${view.value ? ' magazine-with-value' : ''}${view.note ? ' magazine-with-note' : ''}${documents.length ? ' magazine-with-document' : ''}${config.compact ? ' magazine-compact' : ''}`}
      data-magazine-type={type}
    >
      {hasPhoto && (
        <figure className="briefing-news-photo magazine-photo">
          <img
            src={photo.src}
            alt={photo.alt}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            style={{ objectFit: photo.fit || 'cover' }}
            onError={() => setFailedPhoto(photo.src)}
          />
        </figure>
      )}
      <div className="briefing-card-eyebrow magazine-eyebrow">
        <span className="magazine-type">
          <Icon size={14} aria-hidden="true" />
          {type}
        </span>
        <time
          dateTime={data.reporting?.date || at}
          title={
            data.reporting
              ? `${type === '资讯' ? '报道' : '简报'}日期：${data.reporting.dateLabel}`
              : `${briefingLifecycle(data) === 'live' ? '数据更新' : '产生时间'}：${briefingTime(at, true)}`
          }
        >
          {!data.reporting && briefingLifecycle(data) === 'live' && '更新 '}
          {data.reporting?.dateLabel || briefingTime(at)}
        </time>
        {people.length > 0 && (
          <span
            className="briefing-people-placeholder"
            aria-hidden="true"
            style={{ width: Math.min(people.length, 4) * 19 + 9 }}
          />
        )}
      </div>
      <div className="magazine-main">
        <div className="magazine-copy">
          <h3 title={headline}>{headline}</h3>
          {view.value && (
            <div className="magazine-value">
              <strong>{view.value}</strong>
              <span>{view.unit}</span>
            </div>
          )}
          {view.dots && (
            <div
              className="magazine-dots"
              role="img"
              aria-label={`${view.dots.total}位合成试饮者中${view.dots.selected}位偏好V2`}
            >
              {Array.from({ length: view.dots.total }, (_, i) => (
                <i key={i} className={i < view.dots!.selected ? 'selected' : ''} />
              ))}
            </div>
          )}
          {view.steps && (
            <div className="magazine-steps">
              {view.steps.map((step, i) => (
                <div key={step}>
                  <b>{String(i + 1).padStart(2, '0')}</b>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          )}
          {view.chart && <BriefingChart chart={view.chart} spacious={tall} />}
          {view.summary && (
            <p
              className={`magazine-summary${type === '会话' ? ' briefing-reply-preview' : ''}`}
              title={view.summary}
            >
              {view.summary}
            </p>
          )}
          {view.note && (
            <p className="magazine-note" title={view.note}>
              {view.note}
            </p>
          )}
        </div>
        {documents.length > 0 && (
          <div className="magazine-documents">
            <BriefingDocumentCovers documents={documents} />
            <span>资料封面 · {documents.length}份</span>
          </div>
        )}
      </div>
      <div className="magazine-footer">
        {source && (
          <small className="briefing-source" title={source}>
            {source}
            {type === '会话' && ' · AI 最新回复'}
          </small>
        )}
        {hasPhoto && (
          <span className="briefing-photo-credit" title={photo.credit}>
            {photo.credit}
          </span>
        )}
      </div>
    </div>
  );
}
