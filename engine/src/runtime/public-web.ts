import { discoverNews, pagePublication } from './news-discovery.js';
import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { RuntimeError } from './ports.js';
import { isRecord } from './http-json.js';

type Address = { address: string; family: number };
export type WebSource = {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  sha256: string;
  retrievedAt: string;
  kind: 'SEARCH' | 'PAGE';
  truncated: boolean;
  publishedAt?: string;
};
export type WebResponse = { status: number; headers: Record<string, string | undefined>; bytes: Buffer };
export type PinnedRequest = (url: URL, address: Address, signal: AbortSignal) => Promise<WebResponse>;
export function publicAddress(address: string) {
  try {
    const parsed = ipaddr.process(address);
    return (
      parsed.range() === 'unicast' && (parsed.kind() !== 'ipv6' || parsed.match(ipaddr.parseCIDR('2000::/3')))
    );
  } catch {
    return false;
  }
}
export function publicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RuntimeError('PUBLIC_URL_DENIED');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    value.length > 2048 ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    url.hash ||
    (!host.includes('.') && !isIP(host)) ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
    host.endsWith('.') ||
    (isIP(host) && !publicAddress(host))
  )
    throw new RuntimeError('PUBLIC_URL_DENIED');
  return url;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const source = (
  url: string,
  title: string,
  text: string,
  kind: WebSource['kind'],
  truncated = false,
): WebSource => {
  const excerpt = text.slice(0, 4000);
  return {
    id: randomUUID(),
    url,
    title: title.slice(0, 160),
    excerpt,
    sha256: hash(excerpt),
    retrievedAt: new Date().toISOString(),
    kind,
    truncated: truncated || text.length > 4000,
  };
};
/** DNS is resolved/checked once, then the actual TLS connection is pinned to the checked address. */
export const pinnedRequest: PinnedRequest = (url, address, signal) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        agent: false,
        signal,
        family: address.family,
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
        headers: {
          'User-Agent': 'Dreamcore-PublicReader/0.1',
          Accept: 'text/html,text/plain,application/json',
          'Accept-Encoding': 'identity',
        },
        maxHeaderSize: 16384,
      },
      (response) => {
        const headers = Object.fromEntries(
          Object.entries(response.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]),
        );
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
          response.destroy();
          resolve({ status: response.statusCode, headers, bytes: Buffer.alloc(0) });
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 524288) {
            response.destroy(new RuntimeError('PUBLIC_OUTPUT_LIMIT'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({ status: response.statusCode || 0, headers, bytes: Buffer.concat(chunks) }),
        );
        response.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
export class PublicReader {
  constructor(
    private readonly resolveHost = (host: string) => lookup(host, { all: true }),
    private readonly transport: PinnedRequest = pinnedRequest,
  ) {}
  async fetch(
    value: string,
    signal: AbortSignal,
    allowRedirects = true,
  ): Promise<{ url: string; response: WebResponse }> {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(7000)]);
    try {
      let url = publicUrl(value);
      for (let hop = 0; hop <= 3; hop++) {
        bounded.throwIfAborted();
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = isIP(host)
          ? [{ address: host, family: isIP(host) }]
          : await abortable(this.resolveHost(host), bounded);
        if (
          !addresses.length ||
          addresses.length > 32 ||
          addresses.some((a) => !publicAddress(a.address) || ![4, 6].includes(a.family))
        )
          throw new RuntimeError('PUBLIC_ADDRESS_DENIED');
        bounded.throwIfAborted();
        const response = await this.transport(url, addresses[0], bounded);
        bounded.throwIfAborted();
        if (response.bytes.length > 524288) throw new RuntimeError('PUBLIC_OUTPUT_LIMIT');
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (!allowRedirects) throw new RuntimeError('PUBLIC_REDIRECT_DENIED');
          if (hop === 3 || !response.headers.location) throw new RuntimeError('PUBLIC_REDIRECT_LIMIT');
          url = publicUrl(new URL(response.headers.location, url).href);
          continue;
        }
        if (response.status !== 200) throw new RuntimeError('PUBLIC_READ_FAILED');
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
          throw new RuntimeError('PUBLIC_ENCODING_UNSUPPORTED');
        return { url: url.href, response };
      }
      throw new RuntimeError('PUBLIC_REDIRECT_LIMIT');
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError(signal.aborted ? 'CANCELLED' : 'PUBLIC_READ_FAILED');
    }
  }
  async discover(url: string, signal: AbortSignal) {
    const fetched = await this.fetch(url, signal);
    const type = fetched.response.headers['content-type'] ?? '';
    if (!/^(text\/(html|plain|xml)|application\/(rss\+xml|atom\+xml|xml))(;|$)/i.test(type))
      throw new RuntimeError('PUBLIC_FORMAT_UNSUPPORTED');
    const body = new TextDecoder('utf-8', { fatal: true }).decode(fetched.response.bytes);
    return discoverNews(body, fetched.url);
  }
  async read(url: string, signal: AbortSignal) {
    const fetched = await this.fetch(url, signal),
      type = fetched.response.headers['content-type'] || '';
    const charset = /charset\s*=\s*"?([^;"\s]+)/i.exec(type)?.[1]?.toLowerCase();
    if (!/^text\/(html|plain)(;|$)/i.test(type) || (charset && !['utf-8', 'us-ascii'].includes(charset)))
      throw new RuntimeError('PUBLIC_FORMAT_UNSUPPORTED');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(fetched.response.bytes);
    } catch {
      throw new RuntimeError('PUBLIC_ENCODING_UNSUPPORTED');
    }
    const extracted = type.toLowerCase().startsWith('text/html')
      ? extractHtml(text)
      : { title: new URL(fetched.url).hostname, text, truncated: false };
    const result = source(fetched.url, extracted.title, extracted.text, 'PAGE', extracted.truncated);
    const publishedAt = pagePublication(text);
    return publishedAt ? { ...result, publishedAt } : result;
  }
}
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(new RuntimeError('CANCELLED'));
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
export function extractHtml(html: string) {
  const document = parse(html),
    stack: DefaultTreeAdapterMap['node'][] = [document],
    parts: string[] = [];
  let title = '',
    length = 0,
    nodes = 0,
    truncated = false;
  while (stack.length) {
    const node = stack.pop()!;
    if (++nodes > 30000) {
      truncated = true;
      break;
    }
    if ('tagName' in node) {
      if (
        ['script', 'style', 'noscript', 'template', 'iframe', 'svg', 'form', 'nav', 'footer'].includes(
          node.tagName,
        ) ||
        node.attrs.some((a) => a.name === 'hidden' || (a.name === 'aria-hidden' && a.value === 'true'))
      )
        continue;
      if (node.tagName === 'title') {
        title = node.childNodes
          .filter((n) => 'value' in n)
          .map((n) => ('value' in n ? n.value : ''))
          .join('')
          .trim();
        continue;
      }
    }
    if ('value' in node) {
      const value = node.value.replace(/\s+/g, ' ').trim();
      if (value) {
        parts.push(value);
        length += value.length + 1;
        if (length > 12000) {
          truncated = true;
          break;
        }
      }
    }
    if ('childNodes' in node) stack.push(...[...node.childNodes].reverse());
  }
  return { title: title || '公开网页', text: parts.join('\n').trim(), truncated };
}
export interface PublicSearch {
  search(query: string, signal: AbortSignal): Promise<WebSource[]>;
}
export class SearxSearch implements PublicSearch {
  private readonly endpoint: URL;
  constructor(
    endpoint: string,
    private readonly reader = new PublicReader(),
  ) {
    this.endpoint = publicUrl(endpoint);
    if (this.endpoint.pathname !== '/search' || this.endpoint.search)
      throw new RuntimeError('INVALID_SEARCH_ENDPOINT');
  }
  async search(query: string, signal: AbortSignal) {
    const url = new URL(this.endpoint);
    url.search = new URLSearchParams({ q: query, format: 'json', safesearch: '1' }).toString();
    const { response } = await this.reader.fetch(url.href, signal);
    if (!response.headers['content-type']?.includes('application/json'))
      throw new RuntimeError('INVALID_SEARCH_RESPONSE');
    let value: unknown;
    try {
      value = JSON.parse(response.bytes.toString('utf8'));
    } catch {
      throw new RuntimeError('INVALID_SEARCH_RESPONSE');
    }
    if (!isRecord(value) || !Array.isArray(value.results)) throw new RuntimeError('INVALID_SEARCH_RESPONSE');
    const items: WebSource[] = [];
    const seen = new Set<string>();
    for (const item of value.results.slice(0, 20)) {
      if (
        !isRecord(item) ||
        typeof item.url !== 'string' ||
        typeof item.title !== 'string' ||
        typeof item.content !== 'string'
      )
        continue;
      let url: URL;
      try {
        url = publicUrl(item.url);
      } catch {
        continue;
      }
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      const snippet = extractHtml(item.content);
      items.push(
        source(
          url.href,
          extractHtml(item.title).text,
          snippet.text.slice(0, 500),
          'SEARCH',
          snippet.truncated || snippet.text.length > 500,
        ),
      );
      if (items.length === 3) break;
    }
    return items;
  }
}
/** Only the platform-approved, immutable user query leaves the task. The model cannot supply a URL/query. */
export class PublicWebTask {
  private sources = new Map<string, WebSource>();
  private searchPromise?: Promise<void>;
  private readPromises = new Map<string, Promise<WebSource>>();
  private reads = 0;
  constructor(
    readonly query: string,
    private readonly reader: PublicReader,
    private readonly search?: PublicSearch,
    private readonly news = false,
    private readonly seen: { url: string; sha256: string }[] = [],
  ) {}
  async find(signal: AbortSignal) {
    this.searchPromise ??= this.findOnce(signal);
    await this.searchPromise;
    return this.snapshot();
  }
  private async findOnce(signal: AbortSignal) {
    if (/^https:\/\//i.test(this.query)) {
      const url = publicUrl(this.query);
      if (this.news) {
        for (const candidate of (await this.reader.discover(url.href, signal)).slice(0, 2)) {
          const item = await this.reader.read(publicUrl(candidate.url).href, signal);
          if (candidate.publishedAt && !item.publishedAt) item.publishedAt = candidate.publishedAt;
          if (item.publishedAt && Date.parse(item.publishedAt) < Date.now() - 30 * 86400000) continue;
          if (this.seen.some((old) => old.url === item.url && old.sha256 === item.sha256)) continue;
          this.sources.set(item.id, item);
        }
        return;
      }
      const item = source(url.href, url.hostname, '用户指定公开网址，尚未读取页面', 'SEARCH');
      this.sources.set(item.id, item);
    } else {
      if (!this.search) throw new RuntimeError('PUBLIC_SEARCH_NOT_CONFIGURED');
      for (const item of (await this.search.search(this.query, signal)).slice(0, 3))
        this.sources.set(item.id, item);
    }
  }
  async read(id: string, signal: AbortSignal) {
    const item = this.sources.get(id);
    if (!item) throw new RuntimeError('PUBLIC_SOURCE_NOT_GRANTED');
    if (item.kind === 'PAGE') return structuredClone(item);
    let promise = this.readPromises.get(id);
    if (!promise) {
      if (this.reads >= 2) throw new RuntimeError('PUBLIC_READ_LIMIT');
      this.reads++;
      promise = this.reader.read(item.url, signal).then((read) => {
        const updated = { ...read, id };
        if (!updated.publishedAt && item.publishedAt) updated.publishedAt = item.publishedAt;
        this.sources.set(id, updated);
        return updated;
      });
      this.readPromises.set(id, promise);
    }
    return structuredClone(await promise);
  }
  snapshot() {
    return [...this.sources.values()].map((s) => structuredClone(s));
  }
}
