import { EngineAttention } from './EngineAttention';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EngineTelemetry, TenantDistribution } from '../../contracts/public-api/engine-telemetry';
import type { PlatformUsage } from '../../contracts/public-api/usage';
import type { DataOperationOverview } from '../../contracts/public-api/data-operations';
import { IdentityError } from '../identity/client';
import { useSession } from '../identity/session';
import { Failure, Loading } from '../shared/admin';
import { adminHref } from '../admin/navigation';
import { getTelemetry, getTenantDistribution } from './telemetry-client';
import { getOperations } from './client';
import { usageClient } from './usage-client';
import { dataOperationsClient } from './data-client';
import {
  addSample,
  attention,
  changes,
  intakeSegments,
  runs,
  sample,
  week,
  WINDOW_MS,
  type Change,
  type Sample,
} from './engine-dashboard-model';
import { EngineStage3D } from './engine-stage/EngineStage3D';
import './engine-dashboard.css';

import { busyDemo } from './engine-demo';

const FAST_MS = 3000;
const SLOW_MS = 60000;
const n = (v: number) => v.toLocaleString('zh-CN');
const clock = (v: string) => new Date(v).toLocaleTimeString('zh-CN', { hour12: false });
const when = (v: string) => {
  const d = new Date(v),
    today = new Date();
  return d.toDateString() === today.toDateString()
    ? clock(v).slice(0, 5)
    : d.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
};

function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const change = () => setReduced(m.matches);
    m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, []);
  return reduced;
}

/** Reads only while the page is visible; a failed read clears the value instead of showing stale data. */
function usePoll<T>(read: (signal: AbortSignal) => Promise<T>, ms: number, onValue?: (v: T) => void) {
  const { expire } = useSession();
  const [state, setState] = useState<{ value?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [refresh, setRefresh] = useState(0);
  const latest = useRef({ read, onValue });
  latest.current = { read, onValue };
  useEffect(() => {
    let disposed = false,
      active: AbortController | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (disposed || active || document.visibilityState === 'hidden') return;
      clearTimeout(timer);
      active = new AbortController();
      const started = Date.now();
      try {
        const value = await latest.current.read(active.signal);
        if (disposed) return;
        latest.current.onValue?.(value);
        setState({ value, loading: false });
      } catch (error) {
        if (disposed) return;
        setState({ error, loading: false });
        if (error instanceof IdentityError && error.status === 401) expire();
      } finally {
        active = undefined;
        if (!disposed) timer = setTimeout(tick, Math.max(0, ms - (Date.now() - started)));
      }
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    void tick();
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      active?.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [ms, refresh, expire]);
  return { ...state, retry: () => setRefresh((v) => v + 1) };
}

export function PlatformEngineDashboard({ hash }: { hash: string }) {
  const [demo, setDemo] = useState(false);
  const [demoTime, setDemoTime] = useState(Date.now);
  const simulated = useMemo(() => busyDemo(demoTime), [demoTime]);
  useEffect(() => {
    if (!demo) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setDemoTime(Date.now());
    }, FAST_MS);
    return () => clearInterval(timer);
  }, [demo]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [log, setLog] = useState<Change[]>([]);
  const previous = useRef<EngineTelemetry | undefined>(undefined);
  const reduced = useReducedMotion();
  const telemetry = usePoll(
    (signal) => getTelemetry('platform', null, signal),
    FAST_MS,
    (v: EngineTelemetry) => {
      setSamples((old) => addSample(old, sample(v)));
      const prev = previous.current;
      previous.current = v;
      if (prev) setLog((old) => [...changes(prev, v).reverse(), ...old].slice(0, 4));
    },
  );
  const tenants = usePoll((signal) => getTenantDistribution(signal), FAST_MS);
  const operations = usePoll((signal) => getOperations('platform', null, 7, signal), SLOW_MS);
  const usage = usePoll(
    (signal) => usageClient.read('platform', null, 'LAST_30_DAYS', signal) as Promise<PlatformUsage>,
    SLOW_MS,
  );
  const intake = usePoll(
    (signal) =>
      Promise.all([
        dataOperationsClient.list('CONNECTIONS', '', 'ALL', 0, signal),
        dataOperationsClient.list('MATERIALS', '', 'ALL', 0, signal),
      ]),
    SLOW_MS,
  );
  // A failed snapshot leaves no trend or change log that pretends the page kept observing.
  useEffect(() => {
    if (!telemetry.error) return;
    setSamples([]);
    setLog([]);
    previous.current = undefined;
  }, [telemetry.error]);
  const value = telemetry.value;
  const items = value ? attention(value, operations.value) : [];
  return (
    <section className="engine-dash" aria-label="运行看板">
      {telemetry.error ? (
        <div className="engine-dash-failure">
          <h1>运行看板</h1>
          <Failure error={telemetry.error} retry={telemetry.retry} />
        </div>
      ) : !value ? (
        <Loading />
      ) : (
        <>
          <EngineStage3D
            key={demo ? 'demo' : 'live'}
            demo={demo}
            onDemoChange={() => {
              setDemoTime(Date.now());
              setDemo((v) => !v);
            }}
            value={demo ? simulated.value : value}
            samples={demo ? simulated.samples : samples}
            log={demo ? simulated.log : log}
            attentionCount={demo ? 0 : items.length}
            reduced={reduced}
            hash={hash}
          />
          <div className="engine-dash-lower" hidden={demo}>
            <Pulse samples={samples} />
            <section
              id="engine-attention"
              className="engine-dash-c5"
              aria-labelledby="engine-attention-title"
            >
              <div className="engine-dash-title">
                <h2 id="engine-attention-title">需要留意</h2>
                <a className="engine-dash-link" href={adminHref('platform', 'usage', hash)}>
                  查看运行与用量
                </a>
              </div>
              {operations.error !== undefined && (
                <p className="engine-dash-note">任务异常汇总暂时无法读取，下方仅含运行快照。</p>
              )}
              {items.length === 0 ? (
                <p className="engine-dash-empty">
                  {operations.value
                    ? '目前没有失败、中断、待核对或排队较长的记录。'
                    : '当前快照未发现需留意记录，任务异常汇总尚未取得。'}
                </p>
              ) : (
                <ul className="engine-dash-attention">
                  {items.map((a) => (
                    <li key={a.key} data-kind={a.kind}>
                      <i aria-hidden="true" />
                      <div>
                        <strong>{a.title}</strong>
                        <span>{a.detail}</span>
                      </div>
                      <div>
                        <b>{n(a.n)}</b>
                        <span>{a.at ? when(a.at) : '当前'}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <EngineAttention />
            </section>
            <Week usage={usage.value} error={usage.error} />
            <Intake value={intake.value} error={intake.error} hash={hash} />
            <Tenants value={tenants.value} error={tenants.error} />
            <section className="engine-dash-c12 engine-dash-pending" aria-label="尚未接入的观测">
              <span>尚未接入的观测</span>
              {['执行容量', '节点 CPU 与内存', '费用核算', '质量评估'].map((x) => (
                <span key={x} className="engine-dash-hatch">
                  {x}
                </span>
              ))}
              <small>接入前显示为未知，不按 0 计算</small>
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function Pulse({ samples }: { samples: Sample[] }) {
  const now = samples.at(-1)?.at ?? 0;
  const max = Math.ceil(Math.max(4, ...samples.map((s) => s.r)) * 1.15);
  const x = (at: number) => 40 + ((at - (now - WINDOW_MS)) / WINDOW_MS) * 592;
  const y = (v: number) => 180 - (v / max) * 160;
  const area = (r: Sample[], lo: (s: Sample) => number, hi: (s: Sample) => number) => {
    const top = r.map((s) => `${x(s.at).toFixed(1)} ${y(hi(s)).toFixed(1)}`);
    const bottom = r.map((s) => `${x(s.at).toFixed(1)} ${y(lo(s)).toFixed(1)}`).reverse();
    return `M${top.join(' L')} L${bottom.join(' L')} Z`;
  };
  const segments = runs(samples).filter((r) => r.length > 1);
  return (
    <section className="engine-dash-c7" aria-labelledby="engine-pulse-title">
      <div className="engine-dash-title">
        <h2 id="engine-pulse-title">近 5 分钟脉搏</h2>
        <small>只连接本页实际读到的快照，离开页面不保留</small>
      </div>
      {segments.length === 0 ? (
        <p className="engine-dash-empty">已取得 {samples.length} 个快照，等待下一次采样。</p>
      ) : (
        <svg
          className="engine-dash-pulse"
          viewBox="0 0 640 200"
          role="img"
          aria-label={`近 5 分钟执行中数量，已采样 ${samples.length} 次，按输入、处理、输出堆叠`}
        >
          <path d="M40 20H632M40 100H632M40 180H632" className="engine-dash-grid" />
          {segments.map((r, i) => (
            <g key={i}>
              <path
                data-stage="out"
                d={area(
                  r,
                  (s) => s.in + s.pr,
                  (s) => s.in + s.pr + s.out,
                )}
              />
              <path
                data-stage="pr"
                d={area(
                  r,
                  (s) => s.in,
                  (s) => s.in + s.pr,
                )}
              />
              <path
                data-stage="in"
                d={area(
                  r,
                  () => 0,
                  (s) => s.in,
                )}
              />
            </g>
          ))}
          <line x1={x(now)} x2={x(now)} y1="14" y2="180" className="engine-dash-now" />
          <text x="32" y="24" textAnchor="end">
            {max}
          </text>
          <text x="32" y="184" textAnchor="end">
            0
          </text>
          <text x="40" y="198">
            5 分钟前
          </text>
          <text x="632" y="198" textAnchor="end">
            现在
          </text>
        </svg>
      )}
    </section>
  );
}

function Week({ usage, error }: { usage?: PlatformUsage; error?: unknown }) {
  const days = usage ? week(usage.usage.days) : [];
  const maxReq = Math.max(1, ...days.map((d) => d.requests));
  const maxTok = Math.max(1, ...days.map((d) => d.tokens ?? 0));
  return (
    <section className="engine-dash-c7" aria-labelledby="engine-week-title">
      <div className="engine-dash-title">
        <h2 id="engine-week-title">近 7 天节律</h2>
        <span className="engine-dash-keys">
          <span>
            <i className="engine-dash-key-bar" />
            工作请求
          </span>
          <span>
            <i className="engine-dash-key-tok" />
            Token
          </span>
        </span>
      </div>
      {error ? (
        <p className="engine-dash-empty">用量记录暂时无法读取。</p>
      ) : !usage ? (
        <p className="engine-dash-empty">正在读取…</p>
      ) : (
        <div className="engine-dash-week">
          {days.map((d) => (
            <div key={d.date} data-today={d.today || undefined}>
              <div
                className="engine-dash-week-plot"
                aria-label={`${d.date}：工作请求 ${d.requests}，Token ${d.requests > 0 && d.tokens === null ? '未回报' : n(d.tokens ?? 0)}`}
              >
                <i style={{ height: `${((d.requests / maxReq) * 82).toFixed(1)}%` }} />
                {d.tokens !== null && d.requests > 0 && (
                  <em
                    className="engine-dash-tok"
                    style={{ bottom: `${((d.tokens / maxTok) * 92).toFixed(1)}%` }}
                    title={`Token ${n(d.tokens)}`}
                  />
                )}
                {d.tokens === null && d.requests > 0 && <span className="engine-dash-hatch">未回报</span>}
              </div>
              <b>{n(d.requests)}</b>
              <span>{d.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Intake({
  value,
  error,
  hash,
}: {
  value?: [DataOperationOverview, DataOperationOverview];
  error?: unknown;
  hash: string;
}) {
  return (
    <section className="engine-dash-c5" aria-labelledby="engine-intake-title">
      <div className="engine-dash-title">
        <h2 id="engine-intake-title">资料与接入</h2>
        <a className="engine-dash-link" href={adminHref('platform', 'database', hash)}>
          打开数据处理
        </a>
      </div>
      {error ? (
        <p className="engine-dash-empty">数据处理汇总暂时无法读取。</p>
      ) : !value ? (
        <p className="engine-dash-empty">正在读取…</p>
      ) : (
        value.map((row) => {
          const total = row.counts.total;
          const segs = intakeSegments(row.counts);
          return (
            <div key={row.kind} className="engine-dash-intake" data-kind={row.kind}>
              <div>
                <span>{row.kind === 'CONNECTIONS' ? '数据接入' : '资料'}</span>
                <b>共 {n(total)}</b>
              </div>
              <div className="engine-dash-intake-bar" aria-hidden="true">
                {segs.map(([key, , count]) =>
                  count > 0 ? (
                    <i key={key} data-seg={key} style={{ flex: `${Math.max(count, total * 0.012)} 0 0` }} />
                  ) : null,
                )}
              </div>
              <ul>
                {segs.map(([key, label, count]) => (
                  <li key={key} data-seg={key} data-alert={(key === 'attention' && count > 0) || undefined}>
                    <i aria-hidden="true" />
                    {label} <b>{n(count)}</b>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}

function Tenants({ value, error }: { value?: TenantDistribution; error?: unknown }) {
  const max = Math.max(1, ...(value?.tenants.map((t) => t.running) || []));
  return (
    <section className="engine-dash-c12" aria-labelledby="engine-tenants-title">
      <div className="engine-dash-title">
        <h2 id="engine-tenants-title">企业执行分布</h2>
        <small>按执行中数量，只含计数</small>
      </div>
      {error ? (
        <p className="engine-dash-empty">企业执行分布暂时无法读取。</p>
      ) : !value ? (
        <p className="engine-dash-empty">正在读取…</p>
      ) : value.tenants.length === 0 ? (
        <p className="engine-dash-empty">当前没有企业有执行中的记录。</p>
      ) : (
        <>
          <ul className="engine-dash-tenants">
            {value.tenants.map((t) => (
              <li key={t.tenantId}>
                <span title={t.tenantName}>{t.tenantName}</span>
                <span aria-hidden="true">
                  <i style={{ width: `${((t.running / max) * 100).toFixed(1)}%` }} />
                </span>
                <b>{n(t.running)}</b>
              </li>
            ))}
          </ul>
          {value.otherTenants > 0 && (
            <p className="engine-dash-note">
              另有 {n(value.otherTenants)} 家企业，合计 {n(value.otherRunning)} 项执行中。
            </p>
          )}
        </>
      )}
      <p className="engine-dash-note">总库调整核验不属于任何企业，不计入此分布。</p>
    </section>
  );
}
