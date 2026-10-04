import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Activity, ArrowDownToLine, ArrowUpFromLine, Cpu, GitBranch, RefreshCw } from 'lucide-react';
import type {
  EngineTelemetry,
  TelemetryChannel,
  TelemetryChannelCode,
} from '../../contracts/public-api/engine-telemetry';
import { IdentityError } from '../identity/client';
import { useSession } from '../identity/session';
import { Button } from '../shared/ui';
import { Failure, Loading } from '../shared/admin';
import { getTelemetry } from './telemetry-client';
import './telemetry.css';
import './platform-telemetry.css';
const names: Record<TelemetryChannelCode, string> = {
  COLLECTION: '外部取数',
  KNOWLEDGE: '资料解析',
  RETRIEVAL: '资料检索任务',
  TASK: '会话与画报任务',
  COMPANY: '企业信息分析',
  EXPERIENCE: '经验提炼与核验',
  GENERALIZATION: '通用经验清洗',
  GENERAL_ADJUSTMENT: '总库调整核验',
  RESPONSE: '会话流式输出',
  EXPORT: '成果导出',
};
const groups = [
  {
    id: 'input',
    title: '输入',
    english: 'INPUT',
    icon: ArrowDownToLine,
    codes: ['COLLECTION', 'KNOWLEDGE', 'RETRIEVAL'],
  },
  {
    id: 'process',
    title: '处理',
    english: 'PROCESS',
    icon: Cpu,
    codes: ['TASK', 'COMPANY', 'EXPERIENCE', 'GENERALIZATION', 'GENERAL_ADJUSTMENT'],
  },
  { id: 'output', title: '输出', english: 'OUTPUT', icon: ArrowUpFromLine, codes: ['RESPONSE', 'EXPORT'] },
] as const;
const n = (v: number) => v.toLocaleString('zh-CN');
const time = (v: string) => new Date(v).toLocaleTimeString('zh-CN', { hour12: false });
const sum = (
  rows: TelemetryChannel[],
  k: 'running' | 'queued' | 'waiting' | 'unknown' | 'failed' | 'completedRecent',
) => rows.reduce((v, c) => v + c[k], 0);
type Sample = { at: string; running: number };
export function EngineTelemetryWall({
  scope,
  tenant = null,
}: {
  scope: 'platform' | 'tenant';
  tenant?: string | null;
}) {
  return <Wall key={`${scope}:${tenant}`} scope={scope} tenant={tenant} />;
}
function Wall({ scope, tenant }: { scope: 'platform' | 'tenant'; tenant: string | null }) {
  const { expire } = useSession();
  const pollMs = scope === 'platform' ? 3000 : 15000;
  const [value, setValue] = useState<EngineTelemetry>();
  const [error, setError] = useState<unknown>();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let disposed = false,
      active: AbortController | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      if (disposed || active || document.visibilityState === 'hidden') return;
      clearTimeout(timer);
      active = new AbortController();
      const started = Date.now();
      setLoading(true);
      try {
        const next = await getTelemetry(scope, tenant, active.signal);
        if (disposed) return;
        setValue(next);
        setError(undefined);
        setSamples((old) =>
          [
            ...old.filter(
              (s) =>
                Date.parse(s.at) < Date.parse(next.checkedAt) &&
                Date.parse(s.at) >= Date.parse(next.checkedAt) - 300000,
            ),
            { at: next.checkedAt, running: sum(next.channels, 'running') },
          ].slice(scope === 'platform' ? -101 : -21),
        );
      } catch (e) {
        if (disposed) return;
        setValue(undefined);
        setSamples([]);
        setError(e);
        if (e instanceof IdentityError && e.status === 401) expire();
      } finally {
        active = undefined;
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(read, Math.max(0, pollMs - (Date.now() - started)));
        }
      }
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void read();
    };
    void read();
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      active?.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [scope, tenant, refresh, expire, pollMs]);
  const refreshAction = (
    <Button variant="ghost" icon={RefreshCw} disabled={loading} onClick={() => setRefresh((v) => v + 1)}>
      {loading ? '更新中…' : '刷新'}
    </Button>
  );
  return (
    <section className="engine-page" aria-label="引擎运行监控">
      <div className={`engine-heading ${scope === 'platform' ? 'engine-heading--embedded' : ''}`}>
        <div>
          {scope === 'tenant' ? <h2>企业引擎运行</h2> : <h1>引擎仪表盘</h1>}
          {scope === 'tenant' && <p className="muted">本企业的运行记录 · 只读监控</p>}
        </div>
        <div className="engine-refresh">
          {scope === 'tenant' && refreshAction}
          {scope === 'platform' && value && <small>快照 {time(value.checkedAt)} · 可见时每 3 秒更新</small>}
        </div>
      </div>
      {error ? (
        <Failure error={error} retry={() => setRefresh((v) => v + 1)} />
      ) : !value ? (
        <Loading />
      ) : (
        <Snapshot value={value} samples={samples} loading={loading} compact={scope === 'platform'} />
      )}
    </section>
  );
}
function Snapshot({
  value,
  samples,
  loading,
  compact,
}: {
  value: EngineTelemetry;
  samples: Sample[];
  loading: boolean;
  compact: boolean;
}) {
  const reactor = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<{
    width: number;
    height: number;
    paths: Record<string, string>;
  }>();
  useLayoutEffect(() => {
    if (!compact || !reactor.current) return;
    const root = reactor.current;
    const measure = () => {
      const bounds = root.getBoundingClientRect();
      const orb = root.querySelector('.engine-orb')!.getBoundingClientRect();
      const x = orb.left + orb.width / 2 - bounds.left;
      const y = orb.top + orb.height / 2 - bounds.top;
      const paths = Object.fromEntries(
        groups.map((g) => {
          const card = root.querySelector(`.engine-${g.id}`)!.getBoundingClientRect();
          const cx = card.left + card.width / 2 - bounds.left;
          const cy = card.bottom - bounds.top;
          return [g.id, g.id === 'output' ? `M${x} ${y}H${cx}V${cy}` : `M${cx} ${cy}V${y}H${x}`];
        }),
      );
      setGeometry({ width: bounds.width, height: bounds.height, paths });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll('.engine-bank, .engine-orb').forEach((node) => observer.observe(node));
    measure();
    return () => observer.disconnect();
  }, [compact]);
  const rows = value.channels,
    running = sum(rows, 'running');
  const recent = rows
    .filter((c) => c.lastCompletedAt)
    .sort((a, b) => Date.parse(b.lastCompletedAt!) - Date.parse(a.lastCompletedAt!))
    .slice(0, 5);
  let offset = 0;
  const sectors = groups.map((g) => {
    const amount = sum(
      rows.filter((c) => (g.codes as readonly string[]).includes(c.code)),
      'running',
    );
    const start = offset;
    offset += running ? (amount / running) * 100 : 0;
    return { start, end: offset, id: g.id };
  });
  const gradient = sectors.map((s) => `var(--engine-${s.id}) ${s.start}% ${s.end}%`).join(',');
  const RecentContainer = compact ? 'details' : 'section';
  const core = (
    <div className="engine-core">
      <div
        className="engine-orb"
        style={
          {
            '--engine-ring': running ? `conic-gradient(${gradient})` : 'conic-gradient(#34506a 0% 100%)',
          } as CSSProperties
        }
      >
        <div>
          <small>ENGINE</small>
          <strong>{n(running)}</strong>
          <span>{compact ? '全链路执行中' : '登记执行中'}</span>
        </div>
      </div>
      {!compact && <p>输入 · 处理 · 输出</p>}
      {!compact && <small>按记录归组，不是完成百分比</small>}
    </div>
  );
  return (
    <div
      className={`engine-wall ${compact ? 'engine-observatory' : ''}`}
      data-active={running > 0 ? true : undefined}
    >
      {!compact && (
        <div className="engine-status">
          <span>
            <Activity size={14} /> {loading ? '正在更新' : '已读取运行快照'}
          </span>
          <span>
            快照 {time(value.checkedAt)} · 可见时每 {compact ? 3 : 15} 秒更新
          </span>
        </div>
      )}
      {!compact && (
        <dl className="engine-totals">
          {[
            ['登记执行中', running],
            ['排队', sum(rows, 'queued')],
            ['等待 / 部分完成', sum(rows, 'waiting')],
            ['结果待核对', sum(rows, 'unknown')],
            ['保留的失败 / 中断', sum(rows, 'failed')],
          ].map(([label, count]) => (
            <div
              key={label}
              data-alert={label === '保留的失败 / 中断' && Number(count) > 0 ? true : undefined}
            >
              <dt>{label}</dt>
              <dd>{n(Number(count))}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="engine-reactor" ref={reactor}>
        <svg
          className="engine-wires"
          viewBox={compact && geometry ? `0 0 ${geometry.width} ${geometry.height}` : '0 0 1000 460'}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {groups.map((g, i) => {
            const wire = compact
              ? geometry?.paths[g.id] || ''
              : g.id === 'input'
                ? 'M330 105H390L500 230'
                : g.id === 'process'
                  ? 'M500 230L610 105H670'
                  : 'M500 230L610 355H670';
            return (
              <g key={g.id}>
                <path
                  data-active={sectors[i].end > sectors[i].start ? true : undefined}
                  d={wire}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                {compact && (
                  <circle className="engine-transfer-packet" r="2.8" fill={`var(--engine-${g.id})`}>
                    <animateMotion
                      dur={g.id === 'process' ? '3s' : '5s'}
                      repeatCount="indefinite"
                      path={wire}
                    />
                  </circle>
                )}
              </g>
            );
          })}
          {!compact && (
            <path
              className="engine-evolution-wire"
              d="M330 355H390L500 230"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="3 8"
            />
          )}
          {!compact && (
            <circle cx="500" cy="230" r="50" fill="none" stroke="currentColor" strokeDasharray="3 8" />
          )}
        </svg>
        {groups.map((g) => {
          const list = rows.filter((c) => (g.codes as readonly string[]).includes(c.code));
          const count = sum(list, 'running');
          return (
            <section key={g.id} className={`engine-bank engine-${g.id}`} aria-label={`${g.title}运行状态`}>
              <div className="engine-bank-heading">
                <div>
                  <small>{g.english}</small>
                  <h3>
                    <g.icon size={19} />
                    {g.title}
                  </h3>
                </div>
                <strong>
                  {n(count)}
                  <small>登记执行中</small>
                </strong>
              </div>
              {compact ? (
                <ChannelChart kind={g.id} channels={list} />
              ) : (
                <div>
                  <div className="engine-channels">
                    {list.map((c) => (
                      <div key={c.code} className="engine-channel">
                        <span>{names[c.code]}</span>
                        <i aria-hidden="true">
                          <b style={{ width: `${count ? (c.running / count) * 100 : 0}%` }} />
                        </i>
                        <strong>{n(c.running)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="engine-bank-state">
                排队 {n(sum(list, 'queued'))} · 等待 {n(sum(list, 'waiting'))} · 待核对{' '}
                {n(sum(list, 'unknown'))}
              </p>
              <div className="engine-bank-foot">
                <span>
                  近 5 分钟处理完成 <b>{n(sum(list, 'completedRecent'))}</b>
                </span>
                <span className={sum(list, 'failed') > 0 ? 'engine-bank-alert' : undefined}>
                  保留异常 <b>{n(sum(list, 'failed'))}</b>
                </span>
              </div>
            </section>
          );
        })}
        {core}
        <section className="engine-bank engine-evolution" aria-label="自进化运行状态">
          <div className="engine-bank-heading">
            <div>
              <small>EVOLUTION</small>
              <h3>
                <GitBranch size={19} />
                自进化
              </h3>
            </div>
            <span className="engine-unavailable">未启用</span>
          </div>
          {compact ? (
            <div className="engine-learning-layout">
              <div className="engine-learning-intro">
                <GitBranch size={34} strokeWidth={1.2} aria-hidden="true" />
                <div>
                  <strong>持续改进闭环</strong>
                  <p>独立执行器尚未接通</p>
                </div>
              </div>
              <svg
                className="engine-learning-diagram"
                viewBox="0 0 620 130"
                role="img"
                aria-label="预留自进化流程：发现、候选、验证、采用，形成循环；当前未启用"
              >
                <path d="M65 52H555V110H65V52" fill="none" stroke="#af95de55" strokeWidth="1.5" />
                {[
                  ['发现', '运行反馈'],
                  ['候选', '改进方案'],
                  ['验证', '效果核验'],
                  ['采用', '经验更新'],
                ].map(([label, caption], i) => (
                  <g key={label} transform={`translate(${65 + i * 163} 52)`}>
                    <circle r="25" fill="#24283e" stroke="#ad91dc77" />
                    <text textAnchor="middle" y="4" fill="#d2bce9" fontSize="12">
                      {label}
                    </text>
                    <text textAnchor="middle" y="44" fill="#a79bb8" fontSize="10">
                      {caption}
                    </text>
                  </g>
                ))}
                <path d="M65 110l7 -5v10z" fill="#af95de77" />
              </svg>
              <div className="engine-learning-note">
                <span>流程预留</span>
                <p>
                  经验提炼与清洗
                  <br />
                  仍计入处理区
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="engine-evolution-body">
                <p>独立自进化执行器尚未接通。</p>
                <div className="engine-evolution-flow" aria-hidden="true">
                  <span>发现</span>›<span>候选</span>›<span>验证</span>›<span>采用</span>
                </div>
              </div>
              <p className="engine-bank-state">基础经验提炼与清洗计入处理区，不作为自进化执行。</p>
            </>
          )}
        </section>
      </div>
      <div className="engine-secondary">
        <section className="engine-panel">
          <h3>执行资源与口径</h3>
          <dl className="engine-resource">
            <div>
              <dt>已接入的运行类别</dt>
              <dd>{rows.length}</dd>
            </div>
            <div>
              <dt>执行容量 / 物理占用</dt>
              <dd>未接入</dd>
            </div>
            <div>
              <dt>{value.tenantId ? '企业专属 CPU / 内存' : '工作节点 CPU / 内存'}</dt>
              <dd>未知</dd>
            </div>
          </dl>
          {compact ? (
            <details className="engine-details">
              <summary>查看执行口径</summary>
              <p>
                登记执行中包含真实与验证运行，不等于模型请求数。会话流式输出期间仅计入输出区，避免重复计数。
              </p>
            </details>
          ) : (
            <p>
              登记执行中包含真实与验证运行，不等于模型请求数。会话流式输出期间仅计入输出区，避免重复计数。
            </p>
          )}
        </section>
        <section className="engine-panel">
          <h3>
            登记执行趋势 <small>当前页面观测 · 最多 5 分钟</small>
          </h3>
          <Trend samples={samples} maxGap={compact ? 9000 : 45000} />
          <p>只连接本页实际读到的快照；空白期间无采样，离开页面后不保留。</p>
        </section>
      </div>
      <RecentContainer className={`engine-panel engine-recent ${compact ? 'engine-details' : ''}`}>
        {compact ? (
          <summary>各类最近完成 · 仅聚合时间，不含内容</summary>
        ) : (
          <h3>
            各类最近完成 <small>保留记录的聚合时间，不含内容</small>
          </h3>
        )}
        {recent.length ? (
          <ul>
            {recent.map((c) => (
              <li key={c.code}>
                <time>{new Date(c.lastCompletedAt!).toLocaleString('zh-CN', { hour12: false })}</time>
                <span>{names[c.code]}</span>
                <span>处理完成记录</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>暂无已完成记录。</p>
        )}
      </RecentContainer>
      {compact ? (
        <details className="engine-caption engine-details">
          <summary>统计范围与状态说明</summary>
          <p>
            仅覆盖已接入的运行记录；失败与中断为保留记录数，可能含历史尝试。处理完成不等于业务成功、内容合格或用户已阅读。队列与模型用量分别统计。
          </p>
        </details>
      ) : (
        <p className="engine-caption">
          仅覆盖已接入的运行记录；失败与中断为保留记录数，可能含历史尝试。处理完成不等于业务成功、内容合格或用户已阅读。队列与模型用量分别统计。
        </p>
      )}
    </div>
  );
}
function ChannelChart({
  kind,
  channels,
}: {
  kind: 'input' | 'process' | 'output';
  channels: TelemetryChannel[];
}) {
  const total = sum(channels, 'running');
  const max = Math.max(1, ...channels.map((c) => c.running));
  if (kind === 'input')
    return (
      <div className="engine-input-chart" aria-label="输入通道执行数量柱形图">
        {channels.map((c) => (
          <div key={c.code}>
            <div className="engine-input-column">
              <strong>{n(c.running)}</strong>
              <div className="engine-input-track">
                <i style={{ height: `${(c.running / max) * 100}%` }} />
              </div>
            </div>
            <span>{names[c.code]}</span>
          </div>
        ))}
      </div>
    );
  if (kind === 'process')
    return (
      <div className="engine-process-map" aria-label="处理任务节点图">
        {channels.map((c) => (
          <div key={c.code} data-running={c.running > 0 ? true : undefined}>
            <i aria-hidden="true" />
            <span>{names[c.code]}</span>
            <strong>{n(c.running)}</strong>
          </div>
        ))}
      </div>
    );
  return (
    <div className="engine-output-chart" aria-label="输出执行数量与构成">
      {channels.map((c) => (
        <div key={c.code}>
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="36" fill="none" stroke="#76e3bb18" strokeWidth="5" />
            <circle
              cx="50"
              cy="50"
              r="36"
              fill="none"
              stroke="#76e3bb"
              strokeWidth="5"
              strokeDasharray={`${total ? (c.running / total) * 226.2 : 0} 226.2`}
              transform="rotate(-90 50 50)"
            />
          </svg>
          <strong>{n(c.running)}</strong>
          <span>{names[c.code]}</span>
        </div>
      ))}
    </div>
  );
}
function Trend({ samples, maxGap }: { samples: Sample[]; maxGap: number }) {
  if (samples.length < 2)
    return <div className="engine-trend-empty">已取得 {samples.length} 个快照，等待下一次采样</div>;
  const first = Date.parse(samples[0].at),
    last = Date.parse(samples.at(-1)!.at),
    max = Math.max(1, ...samples.map((s) => s.running));
  const pts = samples.map(
    (s) =>
      `${20 + ((Date.parse(s.at) - first) / Math.max(1, last - first)) * 460},${85 - (s.running / max) * 65}`,
  );
  // Long gaps are not interpolated as if the page observed their execution history.
  const lines = samples
    .slice(1)
    .flatMap((s, i) =>
      Date.parse(s.at) - Date.parse(samples[i].at) <= maxGap ? [`${pts[i]} ${pts[i + 1]}`] : [],
    );
  return (
    <div className="engine-trend">
      <svg
        viewBox="0 0 500 110"
        role="img"
        aria-label={`已采样 ${samples.length} 次，当前登记执行中 ${samples.at(-1)!.running}`}
      >
        <path d="M20 20H480M20 85H480" className="engine-trend-grid" />
        {lines.map((p, i) => (
          <polyline key={i} points={p} />
        ))}
        {pts.map((p, i) => (
          <circle key={i} cx={p.split(',')[0]} cy={p.split(',')[1]} r="2.5" />
        ))}
        <text x="0" y="20">
          {max}
        </text>
        <text x="5" y="89">
          0
        </text>
        <text x="20" y="105">
          {time(samples[0].at)}
        </text>
        <text x="480" y="105" textAnchor="end">
          {time(samples.at(-1)!.at)}
        </text>
      </svg>
    </div>
  );
}
