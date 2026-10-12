import {
  createIdentityRequest,
  IdentityError,
  record as isRecord,
  uuid,
  text as isText,
} from '../identity/client.ts';
import type {
  WikiInsight,
  InsightDocument,
  InsightReport,
  InsightMode,
} from '../../contracts/public-api/wiki-insights.ts';
type Evidence = { materialId: string; chunkId: string; quote: string };
type Point = { text: string; evidence: Evidence[] };
type InsightContext = { mode: InsightMode; documents: InsightDocument[] };
const fail = () => {
  throw new Error('INVALID_WIKI_RESULT');
};
const text = (v: unknown, max: number) => {
  if (
    typeof v !== 'string' ||
    !v.trim() ||
    v.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)
  )
    fail();
};
const exact = (v: unknown, keys: string[]) => {
  if (!isRecord(v) || Object.keys(v).sort().join(',') !== keys.sort().join(',')) fail();
};
function wikiInsightContext(value: unknown): InsightContext {
  try {
    const c = value as InsightContext;
    if (
      !['ANALYZE', 'GRAPH', 'RECOMMEND'].includes(c.mode) ||
      !Array.isArray(c.documents) ||
      !c.documents.length ||
      c.documents.length > (c.mode === 'RECOMMEND' ? 18 : 6)
    )
      fail();
    const ids = new Set<string>();
    let anchors = 0;
    for (const d of c.documents) {
      text(d.id, 36);
      text(d.versionId, 36);
      text(d.title, 500);
      if (
        !Number.isInteger(d.version) ||
        d.version < 1 ||
        typeof d.anchor !== 'boolean' ||
        ids.has(d.id) ||
        !Array.isArray(d.fragments) ||
        !d.fragments.length ||
        d.fragments.length > (c.mode === 'RECOMMEND' ? 1 : 10)
      )
        fail();
      ids.add(d.id);
      if (d.anchor) anchors++;
      let length = 0;
      for (const f of d.fragments) {
        text(f.id, 36);
        text(f.content, 3000);
        length += f.content.length;
      }
      if (length > (c.mode === 'RECOMMEND' ? 1000 : 3000)) fail();
    }
    if (!anchors || anchors > 6 || (c.mode !== 'RECOMMEND' && anchors !== c.documents.length)) fail();
    return c;
  } catch {
    throw new Error('INVALID_WIKI_SOURCE');
  }
}
function validateWikiInsight(value: unknown, c: InsightContext): InsightReport {
  try {
    exact(value, ['nodes', 'synthesis', 'relations', 'recommendations']);
    const r = value as InsightReport;
    const ids = c.documents.map((d) => d.id),
      anchors = c.documents.filter((d) => d.anchor).map((d) => d.id);
    const evidence = (list: Evidence[], allowed: string[]) => {
      if (!Array.isArray(list) || !list.length || list.length > 6) fail();
      const cited = new Set<string>();
      for (const e of list) {
        exact(e, ['materialId', 'chunkId', 'quote']);
        text(e.quote, 200);
        if (
          e.quote.length < 6 ||
          !allowed.includes(e.materialId) ||
          !c.documents
            .find((d) => d.id === e.materialId)
            ?.fragments.some((f) => f.id === e.chunkId && f.content.includes(e.quote))
        )
          fail();
        cited.add(e.materialId);
      }
      if (allowed.some((id) => !cited.has(id))) fail();
    };
    const point = (p: Point, limit: number, allowed: string[]) => {
      exact(p, ['text', 'evidence']);
      text(p.text, limit);
      evidence(p.evidence, allowed);
    };
    if (!Array.isArray(r.nodes) || !Array.isArray(r.relations) || !Array.isArray(r.recommendations)) fail();
    if (c.mode === 'ANALYZE') {
      if (r.nodes.length !== ids.length || new Set(r.nodes.map((n) => n.materialId)).size !== ids.length)
        fail();
      for (const n of r.nodes) {
        exact(n, ['materialId', 'summary', 'takeaways']);
        if (
          !ids.includes(n.materialId) ||
          !Array.isArray(n.takeaways) ||
          !n.takeaways.length ||
          n.takeaways.length > 4
        )
          fail();
        point(n.summary, 700, [n.materialId]);
        for (const p of n.takeaways) point(p, 240, [n.materialId]);
      }
      point(r.synthesis!, 1600, ids);
    } else if (r.nodes.length || r.synthesis !== null) fail();
    if (c.mode === 'RECOMMEND') {
      if (r.relations.length || r.recommendations.length > 4) fail();
      const seen = new Set<string>();
      for (const x of r.recommendations) {
        exact(x, ['document', 'anchor', 'reason', 'evidence']);
        if (
          !anchors.includes(x.anchor) ||
          !ids.includes(x.document) ||
          anchors.includes(x.document) ||
          seen.has(x.document)
        )
          fail();
        seen.add(x.document);
        text(x.reason, 350);
        evidence(x.evidence, [x.anchor, x.document]);
      }
    } else {
      if (r.recommendations.length || r.relations.length > 8) fail();
      const seen = new Set<string>();
      for (const x of r.relations) {
        exact(x, ['from', 'to', 'kind', 'reason', 'evidence']);
        const pair = [x.from, x.to].sort().join('/');
        if (
          !ids.includes(x.from) ||
          !ids.includes(x.to) ||
          x.from === x.to ||
          seen.has(pair) ||
          !['topic', 'complement', 'dependency', 'sequence'].includes(x.kind)
        )
          fail();
        seen.add(pair);
        text(x.reason, 450);
        evidence(x.evidence, [x.from, x.to]);
      }
    }
    return r;
  } catch {
    throw new Error('INVALID_WIKI_RESULT');
  }
}

export function isWikiInsight(v: unknown): v is WikiInsight {
  try {
    if (
      !isRecord(v) ||
      ![v.id, v.tenantId, v.conversationId, v.taskId].every(uuid) ||
      !['ANALYZE', 'GRAPH', 'RECOMMEND'].includes(String(v.mode)) ||
      ![
        'QUEUED',
        'RUNNING',
        'WAITING_CAPABILITY',
        'WAITING_INPUT',
        'PAUSED',
        'SUCCEEDED',
        'FAILED',
        'CANCELLED',
        'PARTIAL',
        'SOURCE_CHANGED',
        'RESULT_UNKNOWN',
        'INTERRUPTED',
      ].includes(String(v.status)) ||
      !(v.executionClass === null || ['live', 'verification'].includes(String(v.executionClass))) ||
      !(v.modelName === null || isText(v.modelName))
    )
      return false;
    if (v.status === 'SOURCE_CHANGED')
      return Array.isArray(v.documents) && v.documents.length === 0 && v.report === null;
    const c = wikiInsightContext(v);
    if (
      c.documents.some(
        (d) =>
          !uuid(d.id) ||
          !uuid(d.versionId) ||
          d.fragments.some((f) => !uuid(f.id) || typeof f.locator !== 'string'),
      )
    )
      return false;
    if (v.status === 'SUCCEEDED') validateWikiInsight(v.report, c);
    else if (v.report !== null) return false;
    return true;
  } catch {
    return false;
  }
}
export function createWikiInsightsClient(fetcher: typeof fetch = fetch) {
  const request = createIdentityRequest(fetcher);
  const id = (v: string) => {
    if (!uuid(v)) throw new IdentityError('INVALID_REQUEST', 400);
    return v;
  };
  const root = (tenant: string) => `/api/v1/tenants/${id(tenant)}/wiki-insights`;
  const scoped =
    (tenant: string, target?: string) =>
    (v: unknown): v is WikiInsight =>
      isWikiInsight(v) && v.tenantId === tenant && (!target || v.id === target);
  return {
    list(tenant: string, offset = 0, signal?: AbortSignal) {
      return request(
        root(tenant) + `?offset=${offset}`,
        'GET',
        (v): v is { items: WikiInsight[]; hasMore: boolean } =>
          isRecord(v) &&
          Array.isArray(v.items) &&
          v.items.length <= 20 &&
          typeof v.hasMore === 'boolean' &&
          v.items.every(scoped(tenant)),
        undefined,
        signal,
      );
    },
    detail(tenant: string, target: string, signal?: AbortSignal) {
      return request(root(tenant) + '/' + id(target), 'GET', scoped(tenant, target), undefined, signal);
    },
    start(
      tenant: string,
      mode: InsightMode,
      sources: { materialId: string; versionId: string; generation: number }[],
      requestId: string,
    ) {
      return request(root(tenant), 'POST', (v):v is WikiInsight => scoped(tenant)(v) && v.mode===mode && (v.status==='SOURCE_CHANGED' || v.documents.filter(d=>d.anchor).length===sources.length && sources.every(s=>v.documents.some(d=>d.anchor&&d.id===s.materialId&&d.versionId===s.versionId))), { requestId: id(requestId), mode, sources });
    },
  };
}
export const wikiInsights = createWikiInsightsClient();
