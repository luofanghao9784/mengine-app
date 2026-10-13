import type { GenerationBatch, GenerationState } from '../../contracts/public-api/briefing-generation';
import type { RecommendationItem } from '../../contracts/public-api/recommendation';
import { IdentityError } from '../identity/client';

/** Local walkthrough only (dev build + ?generationDemo): no model is needed and nothing is written. */
export const generationDemo =
  import.meta.env.DEV && new URLSearchParams(location.search).has('generationDemo');
export const demoPollMs = 1200;

const types = ['INSIGHT', 'DATA', 'SUGGESTION', 'RESULT'] as const;
const titles: Record<string, [string, string]> = {
  INSIGHT: [
    '华东区回款周期连续三周拉长',
    '合同回款从签约到到账的中位天数从 31 天升到 38 天，集中在两家渠道客户。',
  ],
  DATA: ['十月上半月新签合同额', '新签合同额较九月同期增长，增量主要来自专业版续约。'],
  SUGGESTION: [
    '建议本周先跟进三笔逾期回款',
    '三笔逾期合计占未回款金额的一半以上，联系人近两周没有沟通记录。',
  ],
  RESULT: ['《季度经营复盘》初稿已保存', '演示文稿已保存到个人空间，包含六页内容，可继续修改。'],
};
type Row = GenerationBatch & {
  start: number;
  kind: string;
  outcome: 'SUCCEEDED' | 'NO_NEW_CONTENT' | 'FAILED';
};
let rows: Row[] = [];
let used = 0;
const stepMs = 4200;
const uid = () => crypto.randomUUID();

function settle() {
  const now = Date.now();
  for (const row of rows) {
    if (!['QUEUED', 'RUNNING'].includes(row.status)) continue;
    if (now < row.start) row.status = 'QUEUED';
    else if (now < row.start + stepMs) row.status = 'RUNNING';
    else {
      row.status = row.outcome;
      row.finishedAt = new Date().toISOString();
      if (row.outcome === 'SUCCEEDED') {
        row.cardIds = [uid()];
        cards.set(row.cardIds[0], row.kind);
        used++;
      } else row.reason = row.outcome === 'FAILED' ? 'TASK_LIMIT' : 'NO_NEW_CONTENT';
    }
  }
}
const cards = new Map<string, string>();
const plain = (row: Row): GenerationBatch => {
  const { start: _start, kind: _kind, outcome: _outcome, ...batch } = row;
  return batch;
};
export const demoGenerationClient = {
  async state(): Promise<GenerationState> {
    settle();
    const reserved = rows.filter((row) => ['QUEUED', 'RUNNING'].includes(row.status)).length;
    return {
      policies: [],
      batches: rows.slice(0, 12).map(plain),
      quota: { limit: 6, used, reserved, remaining: Math.max(0, 6 - used - reserved) },
      capabilities: {
        INFO: { available: false, reason: 'PUBLIC_SEARCH_NOT_CONFIGURED' },
        TOPIC: { available: true, reason: null },
      },
    };
  },
  async batch(_tenant: string, id: string): Promise<GenerationBatch> {
    settle();
    const row = rows.find((candidate) => candidate.id === id);
    // A reload forgets the walkthrough; ids remembered by the page are simply gone.
    if (!row) throw new IdentityError('NOT_FOUND', 404);
    return plain(row);
  },
  async generateSelection(
    _tenant: string,
    body: { workspaceId?: string; count: number; types: string[]; topic?: string },
  ): Promise<GenerationBatch[]> {
    const now = Date.now();
    const next: Row[] = Array.from({ length: body.count }, (_, i) => {
      const type = body.types.length ? body.types[i % body.types.length] : null;
      return {
        id: uid(),
        workspaceId: body.workspaceId || uid(),
        trigger: 'GENERATE_MORE',
        businessType: type,
        status: i === 0 ? 'RUNNING' : 'QUEUED',
        reason: null,
        taskId: null,
        cardIds: [],
        createdAt: new Date(now + i).toISOString(),
        finishedAt: null,
        start: now + i * stepMs,
        kind: type || types[i % types.length],
        // Show every ending in one run: the last of three or more finds nothing new.
        outcome: body.topic?.includes('失败')
          ? 'FAILED'
          : body.count >= 3 && i === body.count - 1
            ? 'NO_NEW_CONTENT'
            : 'SUCCEEDED',
      };
    });
    rows = [...next, ...rows];
    return next.map(plain);
  },
  async cancel(_tenant: string, id: string): Promise<GenerationBatch> {
    settle();
    for (const row of rows)
      if (['QUEUED', 'RUNNING'].includes(row.status)) {
        row.status = 'CANCELLED';
        row.reason = 'USER_CANCELLED';
      }
    return plain(rows.find((row) => row.id === id)!);
  },
};
export async function demoCards(ids: string[]): Promise<RecommendationItem[]> {
  const now = new Date().toISOString();
  return ids
    .filter((id) => cards.has(id))
    .map((id) => {
      const kind = cards.get(id)!;
      const [title, summary] = titles[kind] || titles.INSIGHT;
      return {
        content: {
          kind: 'TASK',
          id,
          versionKey: `task:${id}:1:1`,
          workspaceId: id,
          workspaceName: '个人空间',
          title,
          excerpt: summary,
          truncated: false,
          createdAt: now,
          executionClass: 'verification',
          conversationId: id,
          taskRevision: 1,
          attempt: 1,
          preferenceRevision: 0,
          materialId: null,
          materialVersion: 0,
          filename: '',
          pinned: false,
          openedAt: null,
        },
        briefing: {
          artifactId: id,
          sha256: 'a'.repeat(64),
          content: {
            schemaVersion: 'briefing-text-v1',
            businessType: kind,
            title,
            summary,
            analysis: [summary, '这是本地演示用的合成画报，不代表真实经营数据。'],
            chart: null,
            source: null,
            calculationArtifactId: null,
            calculationSha256: null,
            generatedAt: now,
          },
        },
        score: 0.5,
        method: {
          versionId: null,
          adoptionRevision: 0,
          scope: 'BUILTIN',
          workspaceId: null,
          configurationSha: 'a'.repeat(64),
        },
        presentation: {
          renderer: 'source-preserving-v1',
          style: 'DEFAULT',
          profileId: null,
          profileRevision: 0,
        },
        reason: '',
        availability: 'AVAILABLE_IN_APP',
        feedbackTarget: {
          kind: 'BRIEFING',
          taskId: id,
          taskRevision: 1,
          attempt: 1,
          presentationVersion: 'recommendation-v1',
          presentationRevision: 1,
        },
      } as unknown as RecommendationItem;
    });
}
