import type { EvolutionPhase } from './evolution-demo';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type {
  EngineTelemetry,
  TelemetryChannel,
  TelemetryChannelCode,
} from '../../../contracts/public-api/engine-telemetry';
import { adminHref } from '../../admin/navigation';
import {
  BEADS,
  channelInfo,
  particles,
  runs,
  WINDOW_MS,
  type Change,
  type Sample,
  type Stage,
} from '../engine-dashboard-model';
import { EngineScene, type Focus, type Hit, type Lens, type SceneDom } from './scene';
import './engine-stage.css';

/** Hosts may relabel channels: the tenant scene shell names the input lanes after their data sources. */
type ChannelNameMap = Partial<Record<TelemetryChannelCode, string>>;
const NO_NAMES: ChannelNameMap = {};
const ChannelNames = createContext<ChannelNameMap>(NO_NAMES);
const useChannelName = () => {
  const names = useContext(ChannelNames);
  return (code: TelemetryChannelCode) => names[code] ?? channelInfo[code].name;
};
const n = (v: number) => v.toLocaleString('zh-CN');
const hms = (v: number | string) => new Date(v).toLocaleTimeString('zh-CN', { hour12: false });
const STAGES: Record<Stage | 'evo', { name: string; sum: string; cap: string; small: string }> = {
  in: {
    name: '输入',
    cap: '输入',
    small: '左侧光流',
    sum: '信息从这里进入引擎：外部数据源、上传资料，以及任务需要的检索。',
  },
  pr: {
    name: '处理',
    cap: '工作循环',
    small: '工作循环',
    sum: '会话、画报、业务知识、企业分析与经验处理沿工作循环执行：感知变化、判断是否值得处理、补齐上下文、核实分析，再在授权内推进并决定是否告知。',
  },
  out: { name: '输出', cap: '输出', small: '右侧光流', sum: '结果以流式回复返回给员工，或导出为文件。' },
  evo: {
    name: '自进化',
    cap: '自进化循环',
    small: '自进化循环',
    sum: '标志里的第二条轨道是自进化循环：收集纠正与实际结果，找到重复问题，生成候选改法，对照评估，再按范围启用或回退。独立执行器尚未接入，这条轨道只显示结构，不跑光子；经验提炼与清洗计入处理。',
  },
};
const LENS: Record<Lens, { name: string; cap: string }> = {
  r: { name: '执行中', cap: '光流反映执行活跃度，准确数量见读数' },
  q: { name: '排队', cap: '入口处的光尘对应排队记录，每条一颗，最多 10 颗' },
  w: { name: '等待', cap: '等待资料、决定或部分完成的记录' },
  u: { name: '待核对', cap: '超时或断连后无法确认动作是否已发生的记录' },
  d: { name: '近 5 分钟完成', cap: '梦核表面的迸发对应两次快照之间新完成的记录' },
  f: { name: '保留异常', cap: '珊瑚色标记保留的失败与中断，可能含已重试的历史尝试' },
};
const lensKeys = Object.keys(LENS) as Lens[];
type Vals = { r: number; q: number; w: number; u: number; f: number; d: number };
const vals = (c?: TelemetryChannel): Vals => ({
  r: c?.running ?? 0,
  q: c?.queued ?? 0,
  w: c?.waiting ?? 0,
  u: c?.unknown ?? 0,
  f: c?.failed ?? 0,
  d: c?.completedRecent ?? 0,
});
const sumOf = (list: TelemetryChannel[]) =>
  list.reduce<Vals>(
    (t, c) => {
      const v = vals(c);
      return { r: t.r + v.r, q: t.q + v.q, w: t.w + v.w, u: t.u + v.u, f: t.f + v.f, d: t.d + v.d };
    },
    { r: 0, q: 0, w: 0, u: 0, f: 0, d: 0 },
  );
const stageColor: Record<Stage, string> = { in: 'var(--frost)', pr: 'var(--champagne)', out: 'var(--gold)' };
const X = (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

export function EngineStage3D({
  demo = false,
  onDemoChange,
  value,
  samples,
  log,
  attentionCount,
  reduced,
  hash,
  onScene,
  channelNames,
}: {
  demo?: boolean;
  onDemoChange?: () => void;
  value: EngineTelemetry;
  samples: Sample[];
  log: Change[];
  attentionCount: number;
  reduced: boolean;
  hash: string;
  /** Hosts that add their own world content (scene extension) receive the scene instance. */
  onScene?: (scene: EngineScene | null) => void;
  channelNames?: ChannelNameMap;
}) {
  const nameOf = (code: TelemetryChannelCode) => channelNames?.[code] ?? channelInfo[code].name;
  const [evolutionPhase, setEvolutionPhase] = useState<EvolutionPhase>(demo ? '巡检中' : '待接入');
  const [focus, setFocus] = useState<Focus>(null);
  const [sel, setSel] = useState<TelemetryChannelCode | null>(null);
  const [lens, setLens] = useState<Lens>('r');
  const [tip, setTip] = useState<{ hit: Hit; x: number; y: number } | null>(null);
  const [webgl, setWebgl] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<EngineScene | null>(null);
  const top = useRef<HTMLElement>(null);
  const home = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const labels = useRef<SceneDom['labels']>({});
  const caps = useRef<SceneDom['caps']>({});
  const haloWrap = useRef<HTMLDivElement>(null);
  const halo = useRef<HTMLDivElement>(null);
  const coreNum = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const channels = value.channels;
  const byCode = new Map(channels.map((c) => [c.code, c]));
  const stList = (st: Stage) => channels.filter((c) => channelInfo[c.code].stage === st);
  const focusStage = (st: Stage | 'evo', code: TelemetryChannelCode | null = null) => {
    setFocus((was) => {
      if (!was) requestAnimationFrame(() => closer.current?.focus({ preventScroll: true }));
      return st;
    });
    setSel(code);
  };
  const goHome = () => {
    setFocus(null);
    setSel(null);
    home.current?.focus({ preventScroll: true });
  };
  const latest = useRef({ focusStage, goHome });
  latest.current = { focusStage, goHome };
  const focusRef = useRef(focus),
    selRef = useRef(sel);
  focusRef.current = focus;
  selRef.current = sel;

  useEffect(() => {
    const s = new EngineScene(
      canvas.current!,
      {
        top: top.current!,
        labels: labels.current,
        caps: caps.current,
        haloWrap: haloWrap.current!,
        halo: halo.current!,
        coreNum: coreNum.current!,
        panel: panel.current!,
      },
      {
        evolution: setEvolutionPhase,
        pick: (st, code) => latest.current.focusStage(st, code),
        home: () => latest.current.goHome(),
        hover: (hit, x, y) => setTip(hit ? { hit, x, y } : null),
      },
      reduced,
      demo,
    );
    scene.current = s;
    setWebgl(s.webgl);
    onScene?.(s);
    return () => {
      onScene?.(null);
      s.destroy();
      scene.current = null;
    };
    // The scene lives for the page; reduced motion and data are pushed in below.
  }, []);
  useEffect(() => scene.current?.update(value), [value]);
  useEffect(() => scene.current?.setReduced(reduced), [reduced]);
  useEffect(() => scene.current?.setView(focus, sel, lens), [focus, sel, lens]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest('input,textarea,select,[contenteditable]'))
        return;
      const map: Record<string, Stage | 'evo'> = { '1': 'in', '2': 'pr', '3': 'out', '4': 'evo' };
      if (map[e.key]) latest.current.focusStage(map[e.key]);
      else if (e.key === 'Escape' && focusRef.current) {
        e.preventDefault();
        if (selRef.current) setSel(null);
        else latest.current.goHome();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  const T = sumOf(channels);
  const tot = T[lens];
  const sIn = sumOf(stList('in')),
    sPr = sumOf(stList('pr')),
    sOut = sumOf(stList('out'));
  const mix = [
    ['输入', sIn[lens], '#D6E2EE'],
    ['处理', sPr[lens], '#F1D6A0'],
    ['输出', sOut[lens], '#F0BE72'],
  ] as const;
  const warnTarget = [...channels].sort((a, b) => b.failed + b.unknown - (a.failed + a.unknown))[0];
  return (
    <ChannelNames.Provider value={channelNames ?? NO_NAMES}>
      <div
        className="eng3d"
        data-motion={reduced ? 'reduced' : 'full'}
        data-webgl={webgl ? 'on' : 'off'}
        data-focus={focus || undefined}
      >
        <canvas
          ref={canvas}
          className="eng3d-gl"
          aria-label={demo ? '梦核引擎繁忙演示图（模拟数据）' : '梦核引擎实时运行图'}
        />
        {!webgl && (
          <p className="eng3d-nogl">当前浏览器无法启用 WebGL，3D 运行图不可用，下方读数仍会每 3 秒更新。</p>
        )}
        <header className="eng3d-top" ref={top}>
          <div className="eng3d-brand">
            <h1>
              <button type="button" ref={home} onClick={goHome}>
                引擎仪表盘
              </button>
            </h1>
            <div className="eng3d-trail">
              <i data-idle={T.r ? undefined : true} />
              <span>{T.r ? `${n(T.r)} 项执行中` : '空闲，没有执行中的记录'}</span>
              {attentionCount > 0 && (
                <button
                  type="button"
                  className="eng3d-warn"
                  onClick={() =>
                    warnTarget && warnTarget.failed + warnTarget.unknown > 0
                      ? focusStage(channelInfo[warnTarget.code].stage, warnTarget.code)
                      : document
                          .getElementById('engine-attention')
                          ?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })
                  }
                >
                  {attentionCount} 项需要留意
                </button>
              )}
            </div>
          </div>
          <div className="eng3d-tools">
            {onDemoChange && (
              <button
                type="button"
                role="switch"
                aria-checked={demo}
                className="eng3d-demo-toggle"
                onClick={onDemoChange}
              >
                繁忙演示 <span>{demo ? '开' : '关'}</span>
              </button>
            )}
            {demo && (
              <span className="eng3d-demo-note" role="status">
                演示数据 · 不执行真实任务
              </span>
            )}
            <div className="eng3d-snap">
              <svg width="36" height="14" viewBox="0 0 36 14" aria-hidden="true">
                <path
                  d="M0 7h10l3-5 4 10 3-8 2 3h14"
                  fill="none"
                  stroke="#F1D6A0"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>
                {demo ? '演示快照' : '快照'} <b>{hms(value.checkedAt)}</b>，可见时每 3 秒
              </span>
            </div>
          </div>
        </header>
        <div className="eng3d-labels">
          {channels
            .filter((c) => channelInfo[c.code].stage !== 'pr')
            .map((c) => {
              const v = vals(c),
                st = channelInfo[c.code].stage,
                lv = v[lens];
              return (
                <button
                  key={c.code}
                  type="button"
                  className="eng3d-lbl"
                  data-channel={c.code}
                  data-photons={reduced ? 0 : particles(c.running)}
                  data-queue-dots={Math.min(c.queued, BEADS)}
                  ref={(el) => {
                    if (el) labels.current[c.code] = el;
                    else delete labels.current[c.code];
                  }}
                  aria-label={`${nameOf(c.code)}，执行中 ${v.r}，排队 ${v.q}，查看详情`}
                  onClick={(e) => {
                    e.stopPropagation();
                    focusStage(st, c.code);
                  }}
                  onMouseEnter={() => scene.current?.hoverLabel(c.code)}
                  onMouseLeave={() => scene.current?.hoverLabel(null)}
                >
                  <span className="n">{nameOf(c.code)}</span>
                  <span
                    className="v"
                    style={{ color: lens === 'f' && lv ? 'var(--coral)' : lv ? stageColor[st] : '#5f5c56' }}
                  >
                    {n(lv)}
                  </span>
                  <span className="q">
                    {lens === 'r' ? (
                      <>
                        排队 {n(v.q)}
                        {v.q > BEADS && <span className="more">+{n(v.q - BEADS)}</span>}
                      </>
                    ) : (
                      `执行中 ${n(v.r)}`
                    )}
                    {v.f > 0 && lens !== 'f' && <em> 异常 {n(v.f)}</em>}
                    {v.u > 0 && <em className="u"> 待核对 {n(v.u)}</em>}
                  </span>
                </button>
              );
            })}
          {(['in', 'pr', 'out', 'evo'] as const).map((st) => (
            <button
              key={st}
              type="button"
              className={`eng3d-cap ${st === 'evo' ? 'evo' : ''}`}
              ref={(el) => {
                if (el) caps.current[st] = el;
              }}
              onClick={(e) => {
                e.stopPropagation();
                focusStage(st);
              }}
              onMouseEnter={() => scene.current?.hoverLabel(st)}
              onMouseLeave={() => scene.current?.hoverLabel(null)}
            >
              {STAGES[st].cap}
              {st === 'evo' && (
                <small className="eng3d-evolution-status">
                  {demo ? '演示 · ' : ''}
                  {evolutionPhase}
                </small>
              )}
            </button>
          ))}
        </div>
        <div className="eng3d-halowrap" ref={haloWrap} aria-hidden="true">
          <div className="eng3d-halo" ref={halo} data-active={T.r > 0 ? true : undefined} />
        </div>
        <div className="eng3d-core" ref={coreNum}>
          <b style={{ color: lens === 'f' && tot ? 'var(--coral)' : undefined }}>{n(tot)}</b>
          <span>{LENS[lens].name}</span>
        </div>
        <div className="eng3d-mix">
          <div className="eng3d-ratio" aria-hidden="true">
            {mix.map(([label, v, color]) => (
              <span key={label} style={{ flexGrow: tot ? v / tot : 0, background: color }} />
            ))}
          </div>
          <div className="eng3d-mix-labels">
            {mix.map(([label, v, color]) => (
              <span key={label}>
                <i style={{ background: color }} />
                {label}
                <b>{n(v)}</b>
              </span>
            ))}
          </div>
        </div>
        <div className="eng3d-lens-cap">{LENS[lens].cap}</div>
        <div className="eng3d-reads" role="group" aria-label="查看指标">
          {lensKeys.map((k) => {
            const alert = k === 'f' && T.f > 0;
            return (
              <button
                key={k}
                type="button"
                data-lens={k}
                aria-pressed={lens === k}
                onClick={() => setLens(k)}
              >
                <span>{LENS[k].name}</span>
                <b className={alert ? 'a' : undefined}>{n(T[k])}</b>
                <svg width="60" height="22" viewBox="0 0 60 22" aria-hidden="true">
                  {spark(samples, k).map((p, i) => (
                    <polyline
                      key={i}
                      points={p}
                      fill="none"
                      stroke={alert ? '#FF6F61' : lens === k ? '#F1D6A0' : '#6c6962'}
                      strokeWidth="1"
                    />
                  ))}
                </svg>
              </button>
            );
          })}
        </div>
        <div className="eng3d-log" aria-live="polite">
          {log.length > 0 && <h2>最近变化</h2>}
          {log.map((e) => (
            <button
              key={e.key}
              type="button"
              data-channel={e.code}
              onClick={() => focusStage(channelInfo[e.code].stage, e.code)}
            >
              <time>{hms(e.at)}</time>
              <span>
                {nameOf(e.code)} {e.text}
              </span>
              <b className={e.kind}>{(e.delta > 0 ? '+' : '') + e.delta}</b>
            </button>
          ))}
        </div>
        <Tip tip={tip} channels={byCode} demo={demo} evolutionPhase={evolutionPhase} />
        <div className="eng3d-hint">悬停看读数，点击推进镜头，拖动旋转，按 1 到 4 切换阶段</div>
        <aside
          className="eng3d-panel"
          ref={panel}
          data-open={focus ? true : undefined}
          data-side={focus === 'in' ? 'left' : undefined}
          aria-hidden={focus ? undefined : true}
          inert={focus ? undefined : true}
          aria-label={focus ? `${STAGES[focus].name}详情` : undefined}
        >
          {focus && (
            <Panel
              demo={demo}
              evolutionPhase={evolutionPhase}
              focus={focus}
              sel={sel}
              setSel={setSel}
              list={focus === 'evo' ? [] : stList(focus)}
              samples={samples}
              close={goHome}
              closer={closer}
              hash={hash}
            />
          )}
        </aside>
      </div>
    </ChannelNames.Provider>
  );
}

function spark(samples: Sample[], key: Lens) {
  const xs = samples.slice(-100);
  if (xs.length < 2) return [];
  const last = xs.at(-1)!.at,
    max = Math.max(1, ...xs.map((s) => s[key]));
  return runs(xs)
    .filter((r) => r.length > 1)
    .map((r) =>
      r
        .map(
          (s) =>
            `${(60 - ((last - s.at) / WINDOW_MS) * 60).toFixed(1)},${(20 - (s[key] / max) * 17).toFixed(1)}`,
        )
        .join(' '),
    );
}

function Tip({
  demo,
  evolutionPhase,
  tip,
  channels,
}: {
  demo: boolean;
  evolutionPhase: EvolutionPhase;
  tip: { hit: Hit; x: number; y: number } | null;
  channels: Map<TelemetryChannelCode, TelemetryChannel>;
}) {
  const nameOf = useChannelName();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!tip || !ref.current) return;
    const box = ref.current.parentElement!.getBoundingClientRect(),
      w = ref.current.offsetWidth,
      h = ref.current.offsetHeight;
    let x = tip.x + 18,
      y = tip.y + 18;
    if (x + w > box.width - 12) x = tip.x - w - 18;
    if (y + h > box.height - 12) y = tip.y - h - 18;
    setPos({ x, y });
  }, [tip]);
  const all = [...channels.values()];
  const row = (label: string, v: number, alert = false) => (
    <>
      <dt>{label}</dt>
      <dd className={alert && v ? 'a' : undefined}>{n(v)}</dd>
    </>
  );
  let body = null;
  if (tip?.hit.kind === 'lane') {
    const c = channels.get(tip.hit.code),
      v = vals(c);
    body = (
      <>
        <h3>
          {nameOf(tip.hit.code)}
          <small>{STAGES[tip.hit.st].name}</small>
        </h3>
        <dl>
          {row('执行中', v.r)}
          {row('排队', v.q)}
          {row('近 5 分钟完成', v.d)}
          {row('保留异常', v.f, true)}
        </dl>
        <p>点击查看详情</p>
      </>
    );
  } else if (tip?.hit.kind === 'loop' && tip.hit.st === 'pr') {
    const list = all.filter((c) => channelInfo[c.code].stage === 'pr'),
      s = sumOf(list);
    body = (
      <>
        <h3>
          工作循环<small>处理</small>
        </h3>
        <dl>
          {row('执行中', s.r)}
          {row('排队', s.q)}
          {row('等待', s.w)}
          {row('近 5 分钟完成', s.d)}
        </dl>
        <p>点击查看 {list.length} 类处理任务</p>
      </>
    );
  } else if (tip?.hit.kind === 'loop') {
    body = (
      <>
        <h3>
          自进化循环<small>自进化</small>
        </h3>
        <p className="lead">
          {demo
            ? `${evolutionPhase}演示：展示局部扫描与候选调整，不修改真实系统。`
            : '独立执行器尚未接入，巡核卫星停驻待命，不执行真实修复。'}
        </p>
        <p>点击查看自进化阶段</p>
      </>
    );
  } else if (tip) {
    const s = sumOf(all);
    body = (
      <>
        <h3>
          梦核<small>全链路</small>
        </h3>
        <dl>
          {row('执行中', s.r)}
          {row('排队', s.q)}
          {row('待核对', s.u)}
          {row('保留异常', s.f, true)}
        </dl>
        <p>拖动可以旋转视角</p>
      </>
    );
  }
  return (
    <div
      ref={ref}
      className="eng3d-tip"
      role="status"
      data-on={tip ? true : undefined}
      style={{ transform: `translate3d(${pos.x}px,${pos.y}px,0)` }}
    >
      {body}
    </div>
  );
}

function Panel({
  demo,
  evolutionPhase,
  focus,
  sel,
  setSel,
  list,
  samples,
  close,
  closer,
  hash,
}: {
  demo: boolean;
  evolutionPhase: EvolutionPhase;
  focus: Stage | 'evo';
  sel: TelemetryChannelCode | null;
  setSel: (code: TelemetryChannelCode | null) => void;
  list: TelemetryChannel[];
  samples: Sample[];
  close: () => void;
  closer: React.RefObject<HTMLButtonElement | null>;
  hash: string;
}) {
  const nameOf = useChannelName();
  const info = STAGES[focus];
  const head = (
    <div className="ph">
      <div>
        <small>{info.small}</small>
        <h2>{info.name}</h2>
      </div>
      <button type="button" className="x" ref={closer} onClick={close} aria-label="返回总览">
        {X}
      </button>
    </div>
  );
  if (focus === 'evo')
    return (
      <>
        {head}
        <p className="psum">
          {demo
            ? '巡核卫星演示：扫描局部网格、校准节点、恢复连接，再验证并回到巡检。所有动作仅改变演示画面，不执行真实任务。'
            : info.sum}
        </p>
        <div className="rows">
          {['发现', '候选', '验证', '采用'].map((name) => (
            <div
              key={name}
              className="row static"
              data-current={
                demo &&
                {
                  巡检中: '发现',
                  扫描中: '发现',
                  校准中: '候选',
                  修复中: '候选',
                  验证中: '验证',
                  待接入: '',
                  静态演示: '',
                }[evolutionPhase] === name
                  ? true
                  : undefined
              }
            >
              <span className="rn">{name}</span>
              <span className="rv off">{demo ? (name === '采用' ? '不启用' : '演示') : '未接入'}</span>
              <span className="rq">
                {demo
                  ? {
                      发现: '巡检与局部扫描',
                      候选: '节点校准与连接修复',
                      验证: '校验后恢复核心原色',
                      采用: '不修改真实系统',
                    }[name]
                  : '接入后显示该阶段记录'}
              </span>
            </div>
          ))}
        </div>
        <p className="foot">巡核卫星与修复光点是演示辅助图形，不计入执行记录。独立执行器尚未接入。</p>
      </>
    );
  const s = sumOf(list),
    selected = list.find((c) => c.code === sel);
  return (
    <>
      {head}
      <p className="psum">
        {n(s.r)} 项执行中，排队 {n(s.q)}，近 5 分钟完成 {n(s.d)}。{info.sum}
      </p>
      <div className="rows">
        {list.map((c) => {
          const v = vals(c);
          return (
            <button
              key={c.code}
              type="button"
              className="row"
              data-channel={c.code}
              aria-current={sel === c.code}
              onClick={() => setSel(sel === c.code ? null : c.code)}
            >
              <span className="rn">{nameOf(c.code)}</span>
              <span className={`rv ${v.r ? '' : 'off'}`}>{n(v.r)}</span>
              <span className="rq">
                排队 {n(v.q)}
                {v.f > 0 && <em> 异常 {n(v.f)}</em>}
                {v.u > 0 && <em className="u"> 待核对 {n(v.u)}</em>}
              </span>
            </button>
          );
        })}
      </div>
      {selected && <Detail c={selected} stage={focus} samples={samples} hash={hash} />}
      <p className="foot">处理完成不等于业务成功或内容合格；保留异常可能包含已重试的历史尝试。</p>
    </>
  );
}

function Detail({
  c,
  stage,
  samples,
  hash,
}: {
  c: TelemetryChannel;
  stage: Stage;
  samples: Sample[];
  hash: string;
}) {
  const nameOf = useChannelName();
  const v = vals(c),
    w = 352,
    ht = 70;
  const color = stage === 'in' ? '#D6E2EE' : stage === 'out' ? '#F0BE72' : '#F1D6A0';
  const points = samples.filter((s) => s.ch[c.code]);
  const last = points.at(-1)?.at ?? 0;
  const max = Math.max(4, ...points.map((s) => Math.max(...s.ch[c.code]!))) * 1.15;
  const x = (at: number) => (w - ((last - at) / WINDOW_MS) * w).toFixed(1);
  const y = (val: number) => (ht - (val / max) * (ht - 6)).toFixed(1);
  const segments = runs(points).filter((r) => r.length > 1);
  return (
    <div className="det">
      <p>{channelInfo[c.code].desc}</p>
      <dl className="kv">
        <div>
          <dt>排队</dt>
          <dd>{n(v.q)}</dd>
        </div>
        <div>
          <dt>等待</dt>
          <dd>{n(v.w)}</dd>
        </div>
        <div>
          <dt>待核对</dt>
          <dd>{n(v.u)}</dd>
        </div>
        <div>
          <dt>保留异常</dt>
          <dd className={v.f ? 'a' : undefined}>{n(v.f)}</dd>
        </div>
        <div>
          <dt>近 5 分钟完成</dt>
          <dd>{n(v.d)}</dd>
        </div>
        <div>
          <dt>最近完成</dt>
          <dd className="small">{c.lastCompletedAt ? hms(c.lastCompletedAt) : '暂无'}</dd>
        </div>
      </dl>
      <div>
        <div className="spark-cap">
          <span>近 5 分钟</span>
          <span>实线执行中，虚线排队，仅本页观测</span>
        </div>
        {segments.length === 0 ? (
          <p className="spark-empty">已取得 {points.length} 个快照，等待下一次采样。</p>
        ) : (
          <svg
            viewBox={`0 0 ${w} ${ht + 2}`}
            width="100%"
            role="img"
            aria-label={`${nameOf(c.code)}近 5 分钟执行中与排队`}
          >
            <path d={`M0 ${ht}H${w}`} stroke="rgba(236,234,228,.1)" />
            {segments.map((r, i) => {
              const run = r.map((s) => `${x(s.at)},${y(s.ch[c.code]![0])}`).join(' ');
              return (
                <g key={i}>
                  <polygon
                    points={`${x(r[0].at)},${ht} ${run} ${x(r.at(-1)!.at)},${ht}`}
                    fill={color}
                    fillOpacity=".14"
                  />
                  <polyline points={run} fill="none" stroke={color} strokeWidth="1.3" />
                  <polyline
                    points={r.map((s) => `${x(s.at)},${y(s.ch[c.code]![1])}`).join(' ')}
                    fill="none"
                    stroke="#8E8B84"
                    strokeWidth="1"
                    strokeDasharray="3 4"
                  />
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <div className="acts">
        <a className="btn" href={adminHref('platform', 'usage', hash)}>
          查看运行与用量
        </a>
        {stage === 'in' && (
          <a className="btn" href={adminHref('platform', 'database', hash)}>
            打开数据处理
          </a>
        )}
      </div>
    </div>
  );
}
