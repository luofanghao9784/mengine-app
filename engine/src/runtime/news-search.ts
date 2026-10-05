import { XMLParser } from 'fast-xml-parser';
import { PublicReader, publicUrl, type PublicSearch, type WebSource } from './public-web.js';
import { publicationDate } from './news-discovery.js';
import { createHash, randomUUID } from 'node:crypto';
import { RuntimeError } from './ports.js';
export type NewsSearchScope = {
  version: '1.0';
  topics: { id: string; label: string; query: string }[];
  sources: string[];
};
export function newsSearchScope(value: unknown): NewsSearchScope | undefined {
  if (!value || typeof value !== 'object') return;
  const s = value as NewsSearchScope;
  if (
    s.version !== '1.0' ||
    !Array.isArray(s.topics) ||
    !s.topics.length ||
    s.topics.length > 32 ||
    !Array.isArray(s.sources) ||
    s.sources.length > 3
  )
    return;
  if (
    s.topics.some(
      (t) =>
        !t ||
        typeof t.id !== 'string' ||
        !/^[A-Z_]{1,32}$/.test(t.id) ||
        typeof t.label !== 'string' ||
        typeof t.query !== 'string' ||
        !t.query.trim() ||
        t.query.length > 200 ||
        /[\r\n\0]/.test(t.query),
    )
  )
    return;
  if (
    new Set(s.topics.map((t) => t.id)).size !== s.topics.length ||
    s.sources.some((u) => {
      try {
        publicUrl(u);
        return false;
      } catch {
        return true;
      }
    })
  )
    return;
  return structuredClone(s);
}
/** Public RSS search is a replaceable adapter, not a paid API or a promised upstream SLA. */
export class BingNewsSearch implements PublicSearch {
  constructor(private readonly reader = new PublicReader()) {}
  async search(query: string, signal: AbortSignal): Promise<WebSource[]> {
    const endpoint = new URL('https://www.bing.com/news/search');
    endpoint.search = new URLSearchParams({
      q: query,
      format: 'rss',
    }).toString();
    const { response } = await this.reader.fetch(endpoint.href, signal);
    if (!response.headers['content-type']?.match(/xml|rss/i))
      throw new RuntimeError('INVALID_SEARCH_RESPONSE');
    const body = response.bytes.toString('utf8');
    if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw new RuntimeError('INVALID_SEARCH_RESPONSE');
    let parsed;
    try {
      parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: true }).parse(
        body,
      );
    } catch {
      throw new RuntimeError('INVALID_SEARCH_RESPONSE');
    }
    const values = parsed?.rss?.channel?.item;
    const rows = Array.isArray(values) ? values : values ? [values] : [];
    const found: WebSource[] = [];
    for (const row of rows.slice(0, 20)) {
      if (typeof row.link !== 'string' || typeof row.title !== 'string') continue;
      let url;
      try {
        let raw = new URL(row.link);
        if (['www.bing.com', 'bing.com'].includes(raw.hostname) && raw.pathname === '/news/apiclick.aspx')
          raw = new URL(raw.searchParams.get('url') ?? '');
        url = publicUrl(raw.href);
      } catch {
        continue;
      }
      if (found.some((s) => s.url === url.href)) continue;
      const date = publicationDate(row.pubDate);
      if (date && Date.parse(date) < Date.now() - 30 * 86400000) continue;
      // Feed markup is never treated as tool instructions; the original is read before delivery.
      const excerpt = String(row.description ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
      found.push({
        id: randomUUID(),
        url: url.href,
        title: row.title.slice(0, 160),
        excerpt,
        sha256: createHash('sha256').update(excerpt).digest('hex'),
        retrievedAt: new Date().toISOString(),
        kind: 'SEARCH',
        truncated: false,
        ...(date ? { publishedAt: date } : {}),
      });
      if (found.length >= 3) break;
    }
    return found;
  }
}
