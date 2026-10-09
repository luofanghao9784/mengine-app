/**
 * 合成接口：把主仓库 scripts/design/preview-workspace.ts 里的应答搬到浏览器里，
 * 让真实客户端在没有后台、模型和客户数据的情况下显示出来。所有内容都是示例数据。
 */
import datasetBriefing from '@dreamcore/contracts/fixtures/dataset-briefing.json';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenant = uid(1),
  account = uid(2),
  personal = uid(3),
  ops = uid(6);
const now = new Date().toISOString();
const ago = (h: number) => new Date(Date.parse(now) - h * 3600_000).toISOString();

const conversations = [
  { id: uid(40), workspaceId: ops, title: '城西店定金收款下降原因分析', updatedAt: ago(0.2) },
  { id: uid(41), workspaceId: ops, title: '9 月经营分析报告', updatedAt: ago(3) },
  { id: uid(42), workspaceId: ops, title: '会员留存口径说明', updatedAt: ago(26) },
  { id: uid(43), workspaceId: personal, title: '国庆活动方案初稿', updatedAt: ago(30) },
  { id: uid(44), workspaceId: personal, title: '助手功能说明', updatedAt: ago(80) },
].map((c) => ({ ...c, tenantId: tenant }));

const reply = `**结论：**下降主要来自“私教体验课”定金，9 月该类定金从 41 笔降到 17 笔；其他类型基本持平。

1. **私教体验课**：笔数减少 24 笔，金额减少约 2,640 元，占降幅的 85%。
2. **团课月卡**：金额持平，取消率略升。
3. **取消记录**：9 月有 6 笔在登记后 24 小时内取消，需要核对登记口径。

建议先确认 9 月是否调整过体验课的推广渠道，再对比同期其他门店。`;

const task = (id: string, prompt: string, text: string, artifacts: unknown[] = []) => ({
  id,
  prompt,
  mode: 'AGENT',
  status: 'SUCCEEDED',
  revision: 1,
  attempt: 0,
  summaryCode: null,
  errorCode: null,
  engineVersion: null,
  sourcesUnavailable: false,
  sources: [],
  createdAt: ago(0.3),
  reply: text,
  executionClass: 'live',
  modelName: null,
  artifacts,
  publicQuery: null,
  webSources: [],
  skills: [],
  originals: [],
  waitReason: null,
  requiredInput: null,
  supplementalInput: '',
  reconciliationRequired: false,
});

type Doc = { type: string; title: string; summary: string; analysis: string[] };
const textDocs: Doc[] = [
  {
    type: 'INFO',
    title: '国庆体旅融合带动假日消费，健身门店可借势做节日活动',
    summary: '多地以“运动 + 休闲”模式组织假日赛事与夜间活动，带动周边商户消费。门店可参考夜跑、团课社交等形式延长到店时段。',
    analysis: ['这是合成资讯正文，用于检查阅读详情的排版与行距。', '内容不代表真实新闻来源，也不调用真实模型或外部检索。'],
  },
  {
    type: 'INSIGHT',
    title: '两家门店取消金额偏高，转化流程可能存在共性问题',
    summary: '世纪店与万象店 9 月取消金额均超过 8,000 元，明显高于其他门店。',
    analysis: ['两家门店的取消多发生在登记后 24 小时内，集中在体验课类订单。', '这是合成洞察，用于检查卡片与阅读详情的展示。'],
  },
  {
    type: 'SUGGESTION',
    title: '本周优先复核城西店定金流程',
    summary: '先核对 9 月定金退款与取消记录，再访谈门店前台确认登记口径。',
    analysis: ['第一步核对 9 月定金退款与取消记录，确认是否存在重复登记。', '第二步访谈门店前台，确认体验课定金的登记口径是否调整。'],
  },
  {
    type: 'RESULT',
    title: '9 月经营分析报告已形成，可审阅',
    summary: '共 14 页，含门店对比、会员留存与渠道分析。',
    analysis: ['报告由会话生成并保存在个人空间，当前为第 2 版草稿。', '这是合成成果，用于检查已读状态与卡片展示。'],
  },
];
const dataDoc = structuredClone(datasetBriefing) as typeof datasetBriefing;
dataDoc.content.title = '城西店定金收款环比下降 50%，其余门店基本持平';
dataDoc.content.summary = '城西店 9 月定金实收 3,091 元，较 8 月减少一半；其余四家门店变化均在 ±8% 以内。';
dataDoc.content.chart.metric = '定金收款（元）';
dataDoc.content.chart.baseline = '8 月';
dataDoc.content.chart.current = '9 月';
dataDoc.content.chart.rows = [
  ['滨江店', '5480', '5120'],
  ['城西店', '6182', '3091'],
  ['万象店', '6900', '7230'],
  ['金融城店', '4600', '4480'],
  ['世纪店', '5900', '5640'],
].map(([group, baseline, current], i) => ({
  group,
  baseline,
  current,
  difference: String(Number(current) - Number(baseline)),
  changePercent: (((Number(current) - Number(baseline)) / Number(baseline)) * 100).toFixed(2),
  baselineRank: i + 1,
  currentRank: i + 1,
  issue: null,
}));

const briefTasks = [uid(50), uid(51), uid(52), uid(53), uid(54)];
const briefConversation = uid(45);
const documents: Record<string, unknown> = {
  [briefTasks[0]]: dataDoc,
  ...Object.fromEntries(
    textDocs.map((d, i) => [
      briefTasks[i + 1],
      {
        artifactId: uid(60 + i),
        sha256: 'a'.repeat(64),
        content: {
          schemaVersion: 'briefing-text-v1',
          businessType: d.type,
          title: d.title,
          summary: d.summary,
          analysis: d.analysis,
          chart: null,
          source: null,
          calculationArtifactId: null,
          calculationSha256: null,
          generatedAt: ago(i + 1),
        },
      },
    ]),
  ),
};
const recommendation = (taskId: string, i: number) => {
  const content = (documents[taskId] as { content: { title: string; summary: string } }).content;
  return {
    content: {
      kind: 'TASK',
      id: taskId,
      versionKey: `task:${taskId}:1:1`,
      workspaceId: i === 4 ? personal : ops,
      workspaceName: i === 4 ? '个人空间' : '运营管理中心',
      title: content.title,
      excerpt: content.summary,
      truncated: false,
      createdAt: ago(i * 2 + 0.5),
      executionClass: 'live',
      conversationId: briefConversation,
      taskRevision: 1,
      attempt: 1,
      preferenceRevision: 0,
      materialId: null,
      materialVersion: 0,
      filename: '',
      pinned: false,
      openedAt: i === 4 ? ago(1) : null,
    },
    briefing: documents[taskId],
    score: 1 - i / 10,
    method: { versionId: null, adoptionRevision: 0, scope: 'BUILTIN', workspaceId: null, configurationSha: 'a'.repeat(64) },
    presentation: { renderer: 'source-preserving-v1', style: 'DEFAULT', profileId: null, profileRevision: 0 },
    reason: '',
    availability: 'AVAILABLE_IN_APP',
    feedbackTarget: {
      kind: 'BRIEFING',
      taskId,
      taskRevision: 1,
      attempt: 1,
      presentationVersion: 'recommendation-v1',
      presentationRevision: 1,
    },
  };
};


function answer(method: string, url: URL): unknown {
  const path = url.pathname;
    let json: unknown;
    const conv = conversations.find((c) => path.endsWith('/conversations/' + c.id));
    const briefDoc = briefTasks.find((t) => path.endsWith(`/tasks/${t}/briefing`));
    if (path === '/api/v1/me')
      json = {
        account: { id: account, phone: '+8619900009001', displayName: '林知' },
        platformAdmin: false,
        memberships: [{ tenantId: tenant, tenantName: '合成健身', role: 'MEMBER' }],
      };
    else if (path.endsWith('/phone/configuration')) json = { delivery: 'DISABLED', localPreview: false };
    else if (path.endsWith('/context'))
      json = {
        tenant: { id: tenant, name: '合成健身', status: 'ACTIVE' },
        role: 'MEMBER',
        workspaces: [
          { id: personal, name: '个人空间', kind: 'PERSONAL' },
          { id: ops, name: '运营管理中心', kind: 'SHARED' },
        ],
      };
    else if (path.endsWith('/auth/csrf')) json = { headerName: 'X-CSRF-TOKEN', token: 'synthetic-csrf' };
    else if (briefDoc) json = documents[briefDoc];
    else if (path.endsWith('/library')) {
      const files = [
        ['FOLDER', '门店经营月报', null],
        ['FOLDER', '会员与渠道', null],
        ['DOCUMENT', '9 月收款明细.xlsx', 182_400],
        ['DOCUMENT', '定金登记口径说明.docx', 36_200],
        ['DOCUMENT', '国庆活动方案初稿.pdf', 1_204_000],
        ['DOCUMENT', '门店培训手册 v3.pdf', 4_820_000],
      ] as const;
      json = {
        tenantId: tenant,
        workspaceId: personal,
        folderId: url.searchParams.get('folder'),
        trail: [],
        canMaintain: true,
        maxUploadBytes: 1000000,
        hasMore: false,
        items: files.map(([kind, name, sizeBytes], i) => ({
          id: uid(90 + i),
          tenantId: tenant,
          workspaceId: personal,
          workspaceName: '个人空间',
          folderId: null,
          kind,
          name,
          version: kind === 'DOCUMENT' ? 1 + (i % 3) : 0,
          sizeBytes,
          updatedAt: ago(i * 20 + 2),
          path: ['个人空间'],
          canMaintain: true,
        })),
      };
    } else if (path.endsWith('/governance'))
      json = { tenantId: tenant, ownerId: null, ownerName: null, revision: 0, owner: false,
        canConfigure: false, canAcceptInitialResponsibility: false, canEnterManagement: false,
        capabilities: [], pendingHandover: null };
    else if (path.includes('/conversation-attachments/drafts/')) json = { conversation: null };
    else if (path.includes('/conversations/') && path.endsWith('/attachments')) json = [];
    else if (path.includes('/conversations/') && path.endsWith('/answer-snapshot')) json = { items: [] };
    else if (path.endsWith('/business-status'))
      json = { tenantId: tenant, businessEnabled: true, canExport: false, exitState: null, exportDeadline: null };
    else if (briefTasks.some((t) => path.endsWith('/tasks/' + t))) {
      const id = briefTasks.find((t) => path.endsWith('/tasks/' + t))!;
      json = {
        conversation: { id: briefConversation, tenantId: tenant, workspaceId: ops, title: '画报生成', updatedAt: now },
        tasks: [{ ...task(id, '生成画报', '画报已生成。', [{ id: uid(80), filename: id === briefTasks[0] ? 'briefing-dataset-example.json' : 'briefing-text-example.json', sha256: 'a'.repeat(64), bytes: 100 }]), attempt: 1 }],
        hasMore: false,
        cursor: 1,
      };
    }
    else if (path.endsWith('/conversations'))
      json = { tenantId: tenant, enabled: true, agentMode: 'live', publicWebEnabled: true, items: conversations, hasMore: false };
    else if (conv)
      json = {
        conversation: conv,
        tasks: [task(uid(70), '城西店 9 月定金为什么掉了一半？帮我看看是哪类订单导致的。', reply)],
        hasMore: false,
        cursor: 1,
      };
    else if (path.endsWith('/conversations/' + briefConversation))
      json = {
        conversation: { id: briefConversation, tenantId: tenant, workspaceId: ops, title: '画报生成', updatedAt: now },
        tasks: [],
        hasMore: false,
        cursor: 1,
      };
    else if (path.endsWith('/events')) json = { conversationId: conversations[0].id, items: [], cursor: 1, hasMore: false };
    else if (path.endsWith('/plan-receipts')) json = [];
    else if (path.includes('/recommendations'))
      json = {
        tenantId: tenant,
        settings: { revision: 0, enabled: true },
        items: briefTasks.map(recommendation),
        snapshot: 'a'.repeat(64),
        hasMore: false,
        eligibleTotal: 5,
        rankedCount: 5,
        poolLimited: false,
        poolLimit: 1000,
        businessOutcome: 'NOT_ASSESSED',
      };
    else if (path.endsWith('/briefing/layout')) json = { tenantId: tenant, revision: 0 };
    else if (path.endsWith('/briefing'))
      json = { tenantId: tenant, view: url.searchParams.get('view'), date: null, zone: null, items: [], hasMore: false, asOf: now };
    else if (path.endsWith('/briefing/generation')) json = { policies: [], batches: [] };
    else if (path.endsWith('/workspace/notifications')) json = { tenantId: tenant, conversations: true, briefing: false };
    else if (path.endsWith('/feedback')) json = { feedback: null };
    else if (path.endsWith('/discussion')) {
      const m = path.match(/conversations\/([^/]+)\/tasks\/([^/]+)\/discussion/)!;
      json = {
        conversationId: null,
        title: '画报讨论',
        briefingContext: {
          conversationId: m[1],
          taskId: m[2],
          workspaceId: ops,
          taskRevision: Number(url.searchParams.get('revision')),
          attempt: Number(url.searchParams.get('attempt')),
        },
      };
    }
    else return undefined;
  return json;
}

export function installMockApi() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), location.href);
    if (!url.pathname.startsWith('/api/')) return real(input, init);
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    let json = answer(method, url);
    // 打开画报时客户端会登记一次“已打开”，这里原样回执。
    if (method === 'POST' && url.pathname.endsWith('/recommendations/opened')) {
      const target = JSON.parse(typeof init?.body === 'string' ? init.body : ((await request?.clone().text()) ?? '{}'));
      json = { target, openedAt: new Date().toISOString(), evidence: 'USER_OPEN_ACTION', businessOutcome: 'NOT_ASSESSED' };
    }
    if (json === undefined) ((window as unknown as { __unmocked: string[] }).__unmocked ??= []).push(`${(init?.method ?? request?.method ?? 'GET').toUpperCase()} ${url.pathname}${url.search}`);
    return new Response(JSON.stringify(json ?? { code: 'FIXTURE_UNAVAILABLE' }), {
      status: json === undefined ? 404 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  // 演示里没有流式回答，给一个不发消息的替身。
  class SilentEventSource extends EventTarget {
    readyState = 0;
    onmessage = null;
    onerror = null;
    onopen = null;
    close() {}
  }
  (window as unknown as { EventSource: unknown }).EventSource = SilentEventSource;
}
