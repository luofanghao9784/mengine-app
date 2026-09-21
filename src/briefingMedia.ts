import { canReadCardData, type CardData } from './briefing.ts';
import { canReadMaterial, visibleSpaces } from './libraryModel.ts';
import { dreamIds, type DemoState } from './model.ts';

export type BriefingPhoto = import('./model').SourcePhoto;
// Presentation assets stay separate from business facts and immutable content snapshots.
const editorialPhotos: Record<string, BriefingPhoto> = {
  direction: {
    src: '/images/briefing/team-collaboration.jpg',
    alt: '三位同事围坐在桌前，使用笔记本电脑交流协作',
    credit: '配图：Brooke Cagle / Unsplash · 示意',
    sourceUrl:
      'https://unsplash.com/photos/three-people-sitting-in-front-of-table-laughing-together-g1Kr4Ozfoac',
  },
};
export const briefingPhoto = (data: CardData) =>
  data.photo ||
  (data.type === '资讯' && data.sourceKind === 'news' ? editorialPhotos[data.sourceId] : undefined);

export type BriefingDocument = { id: string; title: string; type: string };
// Covers are current, readable document links, not a second document or a fabricated preview.
export function briefingDocuments(state: DemoState, data: CardData): BriefingDocument[] {
  if (!canReadCardData(state, data)) return [];
  const ids = new Set(data.refs || []);
  if (data.sourceKind === 'material') ids.add(data.sourceId);
  if (data.sourceKind === 'dream') dreamIds.forEach((id) => ids.add(id));
  if (data.sourceKind === 'request') {
    const request = state.requests.find((r) => r.id === data.sourceId && r.kind === 'material');
    if (request) ids.add(request.sourceId);
  }
  if (data.sourceKind === 'collaboration') {
    const request = state.collaborations.find((r) => r.id === data.sourceId && r.status === 'delivered');
    if (request?.resultDocId) ids.add(request.resultDocId);
  }
  // Only one hop of explicit source relationships, never every document in the space.
  for (const id of data.sourceKind === 'dream' ? [] : [...ids]) {
    const material = state.materials.find((d) => d.id === id && canReadMaterial(state, d));
    material?.relations.forEach((related) => ids.add(related));
  }
  return [...ids].flatMap((id) => {
    const material = state.materials.find((d) => d.id === id && canReadMaterial(state, d));
    return material ? [{ id, title: material.title, type: material.type }] : [];
  });
}

export function briefingPeople(state: DemoState, data: CardData): string[] {
  if (data.sourceKind === 'conversation') return [];
  if (!canReadCardData(state, data)) return [];
  if (data.people) return [...new Set(data.people.map((p) => p.name).filter((name) => name.trim()))];
  // Use explicit project ownership / references, never infer membership from similar titles.
  const projectIds = new Set([data.space]);
  for (const ref of data.refs || []) {
    const doc = state.materials.find((d) => d.id === ref);
    if (doc) projectIds.add(doc.space);
  }
  const projects = visibleSpaces(state).filter((s) => s.project && projectIds.has(s.id));
  return [
    ...new Set(
      projects
        .flatMap((s) => [...(s.members.includes(s.owner) ? [s.owner] : []), ...s.members])
        .filter((name) => name.trim()),
    ),
  ];
}
