import { useState } from 'react';
import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { coverSeed } from './cover-seed';
import './news-cover.css';

function Texture({ seed }: { seed: number }) {
  const cx = 90 + (seed % 230),
    cy = 150 + ((seed >>> 8) % 46),
    count = 7 + ((seed >>> 16) % 4),
    step = 26 + ((seed >>> 20) % 13);
  return (
    <svg viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice" role="img" aria-label="资讯主题纹理">
      {Array.from({ length: count }, (_, i) => (
        <ellipse key={i} cx={cx} cy={cy} rx={40 + i * step} ry={(40 + i * step) * 0.58} />
      ))}
    </svg>
  );
}

/**
 * Card faces run the cover into the top edge of the card; the full reading keeps it in the text
 * column with its attribution. Without a source image the cover is a type-coloured texture.
 */
export function NewsCover({
  cover,
  seed = '',
  compact = false,
}: {
  cover?: BriefingDocument['cover'];
  seed?: string;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) cover = null;
  return (
    <figure className={'news-cover' + (compact ? ' is-compact' : '') + (cover ? '' : ' is-texture')}>
      <div className="news-cover-layer">
        {cover ? (
          <img
            src={cover.dataUrl}
            alt="资讯原文配图"
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
        ) : (
          <Texture seed={coverSeed(seed)} />
        )}
      </div>
      {!compact && cover && (
        <figcaption>
          图片来自
          <a href={cover.sourceUrl} target="_blank" rel="noopener noreferrer">
            {cover.sourceTitle || '资讯原文'}
          </a>
        </figcaption>
      )}
      {!compact && !cover && <figcaption>主题纹理 · 非新闻现场图片</figcaption>}
    </figure>
  );
}
