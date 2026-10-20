import { XMLParser } from 'fast-xml-parser';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
export type NewsCandidate = { url: string; title: string; publishedAt?: string; excerpt: string };
export function publicationDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 100) return;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > Date.now() + 86400000) return;
  return new Date(time).toISOString();
}
const text = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number'
      ? String(v)
      : v && typeof v === 'object' && '#text' in v
        ? text((v as Record<string, unknown>)['#text'])
        : '';
const list = (v: unknown): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : v ? [v] : []).filter((x) => x && typeof x === 'object');
export function discoverNews(body: string, base: string): NewsCandidate[] {
  if (body.length > 524288 || /<!DOCTYPE(?!\s+html\s*>)[^>]*|<!ENTITY/i.test(body)) return [];
  const items: NewsCandidate[] = [];
  const push = (url: string, title: string, date: unknown, excerpt = '') => {
    try {
      const u = new URL(url, base);
      u.hash = '';
      if (
        u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        u.origin !== new URL(base).origin ||
        u.href === base ||
        title.trim().length < 5 ||
        /^(无障碍浏览|网站导航|网站地图|联系我们|隐私政策|版权声明)$/.test(title.trim()) ||
        items.some((i) => i.url === u.href)
      )
        return;
      items.push({
        url: u.href,
        title: title.trim().slice(0, 160),
        publishedAt: publicationDate(date),
        excerpt: excerpt.slice(0, 500),
      });
    } catch {}
  };
  if (/<(rss|feed)(\s|>)/i.test(body)) {
    try {
      const parsed = new XMLParser({
        ignoreAttributes: false,
        removeNSPrefix: true,
        parseTagValue: false,
        processEntities: false,
      }).parse(body);
      const feed = parsed.rss?.channel ?? parsed.feed;
      for (const r of list(feed?.item ?? feed?.entry).slice(0, 100)) {
        const links = list(r.link);
        const link =
          typeof r.link === 'string'
            ? r.link
            : links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate')?.['@_href'];
        if (typeof link === 'string')
          push(link, text(r.title), r.pubDate ?? r.published ?? r.updated, text(r.description ?? r.summary));
      }
    } catch {
      return [];
    }
  } else {
    const nodes: DefaultTreeAdapterMap['node'][] = [parse(body)];
    let n = 0;
    while (nodes.length && ++n <= 30000) {
      const node = nodes.pop()!;
      if ('tagName' in node && ['script', 'style', 'nav', 'footer', 'form'].includes(node.tagName)) continue;
      if ('tagName' in node && node.tagName === 'a') {
        const href = node.attrs.find((a) => a.name === 'href')?.value;
        const parts: DefaultTreeAdapterMap['node'][] = [...node.childNodes];
        let title = '';
        while (parts.length) {
          const p = parts.pop()!;
          if ('value' in p) title = p.value + ' ' + title;
          if ('childNodes' in p) parts.push(...p.childNodes);
        }
        if (href) push(href, title.replace(/\s+/g, ' '), undefined);
      }
      if ('childNodes' in node) nodes.push(...[...node.childNodes].reverse());
    }
  }
  return items
    .filter((i) => !i.publishedAt || Date.parse(i.publishedAt) >= Date.now() - 30 * 86400000)
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, 3);
}
export function pagePublication(body: string): string | undefined {
  const nodes: DefaultTreeAdapterMap['node'][] = [parse(body)];
  let n = 0;
  while (nodes.length && ++n <= 30000) {
    const node = nodes.pop()!;
    if ('tagName' in node && node.tagName === 'meta') {
      const key = node.attrs.find((a) => a.name === 'property' || a.name === 'name')?.value.toLowerCase();
      if (
        key &&
        ['article:published_time', 'date', 'pubdate', 'publishdate', 'datepublished'].includes(key)
      ) {
        const date = publicationDate(node.attrs.find((a) => a.name === 'content')?.value);
        if (date) return date;
      }
    }
    if ('childNodes' in node) nodes.push(...node.childNodes);
  }
  return;
}

/** Only editorial body images; generic sharing logos and author avatars are excluded. */
export function articleImages(body: string, base: string): string[] {
  const root = parse(body);const found: string[] = [];
  const walk = (node: DefaultTreeAdapterMap['node'], editorial = false, excluded = false) => {
    if (found.length >= 3) return;
    if ('tagName' in node) {
      const attrs = Object.fromEntries(node.attrs.map(a => [a.name, a.value]));
      const label = (attrs.class || '') + ' ' + (attrs.id || '');
      excluded ||= ['header','footer','nav'].includes(node.tagName) || /avatar|logo|qrcode|advert|promotion|recommend/i.test(label);
      editorial ||= node.tagName === 'article' || /media-wrap|article-content|article-body|rich_media_content/i.test(label);
      if (!excluded && editorial && node.tagName === 'img' && !/头像|二维码|公众号|推广|广告|logo|\.(jpe?g|png)$/i.test(attrs.alt || '')) {
        try { const u = new URL(attrs['data-src'] || attrs.src, base); if (u.protocol === 'https:' && !u.username && !u.password && u.href.length <= 2048) { u.hash='';if(!found.includes(u.href))found.push(u.href); } } catch { /* Missing image never blocks article text. */ }
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child, editorial, excluded);
  };
  walk(root);return found;
}

export function articleImage(body: string, base: string): string | undefined { return articleImages(body,base)[0]; }
