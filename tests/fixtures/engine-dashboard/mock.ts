/**
 * Preview fixture only: answers the dashboard's API reads with synthetic data in the browser.
 * The scenario switch and per-poll jitter exist only here, never in the product page.
 */
import { telemetryChannels } from '../../../contracts/public-api/engine-telemetry';

// [running, queued, waiting, unknown, failed, completedRecent] — same synthetic scenarios as the design prototype.
type Row = [number, number, number, number, number, number];
export const scenarios: Record<string, { label: string; rows: Record<string, Row> }> = {
  idle: {
    label: '空闲',
    rows: {
      COLLECTION: [0, 0, 0, 0, 0, 2], KNOWLEDGE: [0, 0, 0, 0, 1, 0], RETRIEVAL: [0, 0, 0, 0, 0, 0],
      TASK: [0, 0, 0, 0, 0, 1], COMPANY: [0, 0, 0, 0, 0, 0], EXPERIENCE: [0, 0, 0, 0, 0, 0],
      GENERALIZATION: [0, 0, 0, 0, 0, 0], GENERAL_ADJUSTMENT: [0, 0, 0, 0, 0, 0],
      RESPONSE: [0, 0, 0, 0, 0, 1], EXPORT: [0, 0, 0, 0, 0, 0],
    },
  },
  busy: {
    label: '繁忙',
    rows: {
      COLLECTION: [3, 5, 0, 0, 0, 14], KNOWLEDGE: [2, 7, 1, 0, 1, 9], RETRIEVAL: [4, 1, 0, 0, 0, 21],
      TASK: [6, 3, 2, 0, 0, 17], COMPANY: [1, 0, 0, 0, 0, 2], EXPERIENCE: [2, 1, 0, 0, 0, 4],
      GENERALIZATION: [1, 0, 0, 0, 0, 1], GENERAL_ADJUSTMENT: [0, 1, 0, 0, 0, 0],
      RESPONSE: [5, 0, 0, 0, 0, 26], EXPORT: [1, 0, 0, 0, 0, 3],
    },
  },
  alert: {
    label: '有异常',
    rows: {
      COLLECTION: [1, 13, 0, 0, 3, 4], KNOWLEDGE: [2, 4, 2, 0, 2, 6], RETRIEVAL: [2, 0, 0, 0, 0, 8],
      TASK: [3, 6, 4, 2, 1, 7], COMPANY: [0, 0, 1, 0, 0, 0], EXPERIENCE: [1, 2, 0, 1, 0, 1],
      GENERALIZATION: [0, 0, 0, 0, 0, 0], GENERAL_ADJUSTMENT: [0, 0, 0, 0, 0, 0],
      RESPONSE: [2, 0, 0, 0, 0, 9], EXPORT: [0, 1, 0, 1, 1, 0],
    },
  },
};
export const preview = { scenario: 'busy' };
const lastDone: Record<string, string | null> = {};
const jitter = (v: number) => (v > 0 ? Math.max(0, v + Math.floor(Math.random() * 3) - 1) : 0);
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const id = (i: number) => `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`;

function telemetry() {
  const now = new Date();
  const rows = scenarios[preview.scenario].rows;
  return {
    tenantId: null,
    checkedAt: now.toISOString(),
    recentSeconds: 300,
    evolution: 'NOT_CONNECTED',
    channels: telemetryChannels.map((code) => {
      const [r, q, w, u, f, d] = rows[code];
      const completedRecent = jitter(d);
      // Synthetic: a fresh completion now and then, so bursts appear exactly when the window grows.
      if (completedRecent > 0 && Math.random() < 0.4) lastDone[code] = new Date(now.getTime() - 500).toISOString();
      return {
        code,
        running: jitter(r),
        queued: jitter(q),
        waiting: w,
        unknown: u,
        failed: f,
        completedRecent,
        lastCompletedAt: lastDone[code] ?? null,
      };
    }),
  };
}
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
};
function respond(path: string, params: URLSearchParams) {
  const now = new Date(),
    iso = now.toISOString();
  if (path.endsWith('/csrf')) return json({ headerName: 'X-CSRF-TOKEN', token: 'synthetic' });
  if (path === '/api/platform-admin/v1/auth/me')
    return json({
      account: { id: id(0), email: 'preview@example.test', displayName: '合成预览账号' },
      platformAdmin: true,
      memberships: [],
    });
  if (path === '/api/platform-admin/v1/engine-telemetry') return json(telemetry());
  if (path === '/api/platform-admin/v1/engine-telemetry/tenants') {
    const total = preview.scenario === 'idle' ? 0 : preview.scenario === 'busy' ? 26 : 13;
    const shares: [string, number][] = [
      ['九号泡泡健身', 0.38],
      ['青禾设计', 0.26],
      ['远帆物流', 0.18],
      ['拾光教育', 0.12],
      ['合成测试企业', 0.06],
    ];
    return json({
      checkedAt: iso,
      tenants: shares
        .map(([tenantName, s], i) => ({ tenantId: id(i + 1), tenantName, running: Math.round(s * total) }))
        .filter((t) => t.running > 0),
      otherTenants: 0,
      otherRunning: 0,
    });
  }
  if (path === '/api/platform-admin/v1/operations') {
    const alert = preview.scenario === 'alert';
    const errors = alert
      ? [
          { code: 'TASK_MODEL_FAILED', tasks: 4, lastOccurredAt: new Date(now.getTime() - 9 * 60000).toISOString() },
          { code: 'TASK_RESULT_UNKNOWN', tasks: 2, lastOccurredAt: new Date(now.getTime() - 20 * 60000).toISOString() },
        ]
      : [{ code: 'TASK_INTERRUPTED', tasks: 1, lastOccurredAt: new Date(now.getTime() - 14 * 3600000).toISOString() }];
    const failed = errors.reduce((v, e) => v + e.tasks, 0);
    return json({
      tenantId: null,
      days: 7,
      from: new Date(now.getTime() - 7 * 86400000).toISOString(),
      checkedAt: iso,
      tasks: {
        total: failed + 40, queued: 0, running: 0, succeeded: 40, failed: alert ? 4 : 0, cancelled: 0,
        interrupted: alert ? 0 : 1, paused: 0, waitingInput: 0, waitingCapability: 0, partial: 0,
        resultUnknown: alert ? 2 : 0, retryStarts: 0,
      },
      storage: { materials: 0, versions: 0, originalBytes: 0 },
      models: [],
      attemptUsage: [],
      errors,
    });
  }
  if (path === '/api/platform-admin/v1/usage') {
    const week: [number, number | null][] = [[182, 41], [240, 58], [210, 49], [96, null], [74, 17], [265, 63], [131, 30]];
    return json({
      usage: {
        tenantId: null,
        period: params.get('period'),
        timeZone: 'Asia/Shanghai',
        from: new Date(now.getTime() - 30 * 86400000).toISOString(),
        until: iso,
        checkedAt: iso,
        groups: [],
        days: week.map(([req, tok], i) => ({
          date: day(6 - i),
          workRequests: req,
          maintenanceCalls: null,
          unknownMaintenanceRuns: 0,
          inputTokens: tok === null ? null : tok * 8000,
          outputTokens: tok === null ? null : tok * 2000,
        })),
        tools: [],
        storage: { originals: 0, versions: 0, registeredBytes: 0 },
        coverage: { unmeteredWorkAttempts: 0, legacyToolReceipts: 0, evaluation: 'NOT_CONNECTED', evolution: 'NOT_ENABLED' },
        quota: { state: 'NOT_CONFIGURED', unit: null, limit: null, remaining: null },
      },
      cost: { state: 'NOT_CONNECTED', currency: null, verifiedMinor: null, estimatedMinor: null, sharedAllocation: 'NOT_CONFIGURED' },
    });
  }
  if (path === '/api/platform-admin/v1/data-operations') {
    const kind = params.get('kind');
    const alert = preview.scenario === 'alert';
    const c =
      kind === 'MATERIALS'
        ? { ready: alert ? 1279 : 1284, processing: alert ? 18 : 23, attention: alert ? 11 : 4, notStarted: 0, stopped: 2 }
        : { ready: alert ? 4 : 6, processing: 1, attention: alert ? 3 : 1, notStarted: 2, stopped: 0 };
    return json({
      kind,
      query: params.get('query') ?? '',
      state: 'ALL',
      offset: 0,
      checkedAt: iso,
      matchedTenants: 0,
      counts: { total: Object.values(c).reduce((a, b) => a + b, 0), ...c },
      items: [],
      hasMore: false,
    });
  }
  return json({ code: 'NOT_FOUND' }, 404);
}
const original = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith('/api/')) return original(input, init);
  await new Promise((r) => setTimeout(r, 60));
  return respond(url.pathname, url.searchParams);
};
