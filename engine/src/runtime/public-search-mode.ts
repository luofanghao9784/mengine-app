import { RuntimeError } from './ports.js';
export function publicSearchMode(query: string) {
  return query === 'web:required:v1' ? 'REQUIRED' : query === 'web:optional:v1' ? 'AUTO' : undefined;
}
/** Keyword search only; refuse obvious identifiers, URLs, secrets and copied private passages before transport. */
export function publicKeywords(value: unknown, privateTexts: string[] = []) {
  if (typeof value !== 'string') throw new RuntimeError('PUBLIC_QUERY_DENIED');
  const query = value.trim().normalize('NFKC');
  if (
    !query ||
    query.length > 120 ||
    /[\r\n\x00-\x1f@{}\[\]<>]|https?:|\b(?:token|password|secret|api[_ -]?key)\b|\d{5,}/i.test(query)
  )
    throw new RuntimeError('PUBLIC_QUERY_DENIED');
  for (const text of privateTexts) {
    try {
      const visit = (v: unknown): void => {
        if (!v || typeof v !== 'object') return;
        for (const [key, val] of Object.entries(v)) {
          if (
            typeof val === 'string' &&
            /^(name|displayName|tenantName|workspaceName|email|phone)$/.test(key)
          ) {
            const terms = [val.normalize('NFKC'), ...(val.match(/[\u4e00-\u9fff]{2,}/g) ?? [])];
            if (terms.some((t) => t.length >= 2 && query.includes(t)))
              throw new RuntimeError('PUBLIC_QUERY_PRIVATE_CONTENT');
          } else if (typeof val === 'object') visit(val);
        }
      };
      visit(JSON.parse(text));
    } catch (e) {
      if (e instanceof RuntimeError) throw e;
    }

    for (const term of query.split(/[\s,，、;；]+/).filter((t) => t.length >= 6))
      if (text.includes(term)) throw new RuntimeError('PUBLIC_QUERY_PRIVATE_CONTENT');
  }
  return query;
}

export function requirePublicEvidence(mode: string | undefined, searched: boolean, read: boolean) {
  if (mode === 'REQUIRED' && (!searched || !read)) throw new RuntimeError('PUBLIC_SEARCH_REQUIRED');
}
