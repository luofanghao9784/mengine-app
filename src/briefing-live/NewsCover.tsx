import { useState } from 'react';
import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { relatedNewsImages } from './related-news-images';
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
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const related = !cover ? relatedNewsImages[seed] : undefined;
  const src = cover?.dataUrl ?? related?.src;
  const available = !!src && failedSrc !== src;
  return (
    <figure className={'news-cover' + (compact ? ' is-compact' : '') + (available ? '' : ' is-texture')}>
      <div className="news-cover-layer">
        {available ? (
          <img
            src={src}
            alt={related?.alt ?? '资讯原文配图'}
            loading="lazy"
            decoding="async"
            onError={() => setFailedSrc(src!)}
          />
        ) : (
          <Texture seed={coverSeed(seed)} />
        )}
      </div>
      {!compact && available && cover && (
        <figcaption>
          图片来自
          <a href={cover.sourceUrl} target="_blank" rel="noopener noreferrer">
            {cover.sourceTitle || '资讯原文'}
          </a>
        </figcaption>
      )}
      {!compact && available && related && (
        <figcaption>
          {related.caption}
          <br />
          摄影：
          <a href={related.sourceUrl} target="_blank" rel="noopener noreferrer">
            {related.author} / Wikimedia Commons
          </a>
          {' · '}
          <a href={related.licenseUrl} target="_blank" rel="noopener noreferrer">
            {related.license}
          </a>
          {' · 原图未修改，展示随版面裁切'}
        </figcaption>
      )}
      {!compact && !available && <figcaption>主题纹理 · 非新闻现场图片</figcaption>}
    </figure>
  );
}
