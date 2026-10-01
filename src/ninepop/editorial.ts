import type { BriefingEntry } from '../briefingLayout.ts';

/** Keep source dates and relative business priority; give news room throughout the edition. */
export function interleaveNinepopNews(entries: BriefingEntry[]): BriefingEntry[] {
  const news = entries.filter((entry) => entry.data.sourceKind === 'news');
  const business = entries.filter((entry) => entry.data.sourceKind !== 'news');
  if (!news.length || !business.length) return entries;
  const spread: BriefingEntry[] = [];
  let cursor = 0;
  for (let index = 0; index < business.length; index++) {
    spread.push(business[index]);
    if (index % 5 === 2 && cursor < news.length) spread.push(news[cursor++]);
  }
  return [...spread, ...news.slice(cursor)];
}
