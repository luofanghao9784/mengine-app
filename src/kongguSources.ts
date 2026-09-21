import type { SourceLink, SourcePhoto } from './model.ts';
import { kongguResearch as research } from './kongguResearch.ts';

export const KONGGU_STORAGE_KEY = 'enterprise-ai-demo-konggu-v1';
export const kongguMaterialId = (id: string) => `kg-${id}`;
export const kongguSource = (id: string): SourceLink => {
  const s = research.research.sources.find((source) => source.id === id)!;
  return { title: s.title, url: s.url, publishedAt: s.publishedAt, eventDate: s.eventDate };
};
export const kongguPhoto = (id: string): SourcePhoto => {
  const photo = research.research.images.find((image) => image.id === id && image.selected)!;
  return {
    src: photo.url,
    alt: photo.caption,
    credit: photo.credit,
    sourceUrl: kongguSource(photo.sourceId).url,
    fit: photo.kind === '活动宣传图' || photo.kind === '报告原始数据图' ? 'contain' : 'cover',
  };
};
