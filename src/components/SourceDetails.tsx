import { useState } from 'react';
import type { SourceLink, SourcePhoto } from '../model';

export function SourceLinks({ links }: { links?: SourceLink[] }) {
  if (!links?.length) return null;
  return (
    <div className="source-links" aria-label="公开资讯原文">
      {links
        .filter((link) => /^https?:\/\//.test(link.url))
        .map((link) => (
          <div key={link.url}>
            <a href={link.url} target="_blank" rel="noopener noreferrer">
              阅读原文 · {link.title} ↗
            </a>
            <small>
              发布于 {link.publishedAt}
              {link.eventDate ? ` · 事件时间 ${link.eventDate}` : ''}
            </small>
          </div>
        ))}
    </div>
  );
}

export function SourceImage({ photo }: { photo?: SourcePhoto }) {
  const [failed, setFailed] = useState(false);
  if (!photo || failed) return null;
  return (
    <figure className="source-photo">
      <img src={photo.src} alt={photo.alt} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      <figcaption>
        {photo.credit} · {photo.alt}
        {/^https?:\/\//.test(photo.sourceUrl) && (
          <>
            {' '}
            ·{' '}
            <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">
              图片出处 ↗
            </a>
          </>
        )}
      </figcaption>
    </figure>
  );
}
