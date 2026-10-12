import { useEffect, useMemo, useRef, useState } from 'react';
import { EngineStage3D } from '../../operations/engine-stage/EngineStage3D';
import { busyDemo } from '../../operations/engine-demo';
import type { EngineScene, Focus } from '../../operations/engine-stage/scene';
import { DataWork } from './DataWork';
import { activity, aside, daily, steps, STEP_NAMES, tabs, usage } from './content';
import { briefing, homeCards, places, stats, type Item, type Place, type Tone } from './data';
import { related, relations, sourceKind } from './knowledge';
import { GATES, GATE_OF, World } from './world';
import './scene-shell.css';

/**
 * 原型：企业管理端的“场景外壳”。没有侧边栏和页面，整个管理端是一个铺满窗口的 3D 引擎模型，
 * 内容是浮在模型上的一组深色玻璃卡片。
 * - 数据基座、知识库和引擎是同一个模型：切换板块 = 同一台相机移到模型的另一处。
 * - 卡片组有三档：升到顶（专心处理）、半屏、降到底（3D 全屏）。上下滚动自然地在三档之间过渡（没有拖动拉手）。
 * - 导航是一条独立的深色栏，挂在卡片组上方，跟着卡片一起上下滑动；卡片升到顶时它正好在最顶部。
 */
const SCENE: Place[] = ['home', 'data', 'knowledge', 'experience', 'output'];
const SETTINGS: Place[] = ['members', 'usage', 'company'];
const SHORTCUT: Partial<Record<Place, string>> = { data: '1', knowledge: '2', output: '3', experience: '4' };
type Sheet = 'peek' | 'half' | 'full';
const ORDER: Sheet[] = ['peek', 'half', 'full'];
const press = (key: string) =>
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
const typing = (e: Event) =>
  !!(e.target as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable]');

function useReduced() {
  const q = '(prefers-reduced-motion: reduce)';
  const [v, set] = useState(() => !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => set(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return v;
}

export function SceneShell() {
  const reduced = useReduced();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 3000);
    return () => window.clearInterval(t);
  }, []);
  const sim = useMemo(() => busyDemo(now), [now]);

  const [place, setPlace] = useState<Place>('home');
  const [sheet, setSheet] = useState<Sheet>('half');
  const [picked, setPicked] = useState<Partial<Record<Place, string>>>({});
  const [filter, setFilter] = useState<Partial<Record<Place, number>>>({});
  const [gate, setGate] = useState<number | null>(null);
  const [palette, setPalette] = useState(false);
  const [height, setHeight] = useState(() => window.innerHeight);
  /** 滚动过程中卡片组顶边的实时位置；null 表示停在某一档上。 */
  const [live, setLive] = useState<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const scene = useRef<EngineScene | null>(null);
  const world = useMemo(
    () => new World(places.data.items, places.knowledge.items, relations, sourceKind),
    [],
  );

  const hasScene = (p: Place) => SCENE.includes(p);
  const work = place !== 'home';
  /** 有 3D 的板块之间切换时保持的面板位置；去没有 3D 的页面再回来，也回到这一档。 */
  const sceneSheet = useRef<Sheet>('half');
  const allowed: Sheet[] = hasScene(place) ? ORDER : ['peek'];
  const stops: Record<Sheet, number> = {
    // 窄窗口时导航退到第二行，卡片升到顶也要让开它。
    peek: window.innerWidth < 1180 ? 58 : 4,
    half: Math.round(height * 0.6),
    full: height - 66,
  };
  const top = live ?? stops[sheet];
  const state = useRef({ place, sheet, palette, allowed, stops, live });
  state.current = { place, sheet, palette, allowed, stops, live };

  useEffect(() => {
    const on = () => setHeight(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  // 画布始终铺满窗口，卡片盖住下半部分；告诉场景“可见的是上面这一截”，它会把画面收进去，不用重建画布。
  useEffect(() => scene.current?.setViewport(top / height, live !== null), [top, height, live]);

  const current = (p: Place) => picked[p] || (tabs[p][filter[p] ?? 0]?.items ?? places[p].items)[0]?.id || '';
  const pick = (p: Place) => (id: string) => setPicked((old) => ({ ...old, [p]: id }));
  world.view = place === 'data' || place === 'knowledge' ? place : null;
  world.selected = world.view ? current(place) : '';
  world.gate = place === 'data' ? gate : null;
  world.onPick = pick(place);
  world.onGate = setGate;

  const sceneFocus = () =>
    (stage.current?.querySelector('.eng3d')?.getAttribute('data-focus') || null) as Focus;
  const go = (next: Place, id?: string) => {
    if (id) setPicked((old) => ({ ...old, [next]: id }));
    setPlace(next);
    // 切换板块不改变 3D 视图的大小：全屏还是全屏，半屏还是半屏，收起还是收起。
    // 只有去没有 3D 的页面才收起，回来时恢复到之前那一档。
    if (hasScene(place)) sceneSheet.current = sheet;
    setSheet(hasScene(next) ? sceneSheet.current : 'peek');
    setLive(null);
    setPalette(false);
    const want = places[next].focus,
      have = sceneFocus();
    if (want === have) return;
    if (want) press(SHORTCUT[next]!);
    else {
      press('Escape');
      requestAnimationFrame(() => sceneFocus() && press('Escape'));
    }
  };
  const goRef = useRef(go);
  goRef.current = go;
  // 在引擎舞台里直接点某一段也算一次切换：点输入车道 = 去数据基座；点输出、自进化轨道 = 去对应板块。
  useEffect(() => {
    const el = stage.current?.querySelector('.eng3d');
    if (!el) return;
    const observer = new MutationObserver(() => {
      const f = el.getAttribute('data-focus') as Focus;
      const at = state.current.place;
      if (f === 'in') goRef.current('data');
      else if (f === 'out' && at !== 'output') setPlace('output');
      else if (f === 'evo' && at !== 'experience') setPlace('experience');
      else if (!f && places[at].focus) setPlace('home');
    });
    observer.observe(el, { attributes: true, attributeFilter: ['data-focus'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    // 抢在舞台自己的快捷键之前：1、2 去数据基座和知识库（舞台原本会把它们当作“输入”“处理”）。
    const key = (e: KeyboardEvent) => {
      if (!e.isTrusted) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e) || state.current.palette) return;
      const at = state.current.place;
      if (e.key === '1' || e.key === '2') {
        e.stopPropagation();
        goRef.current(e.key === '1' ? 'data' : 'knowledge');
      } else if (e.key === 'Escape' && at !== 'home' && !places[at].focus) {
        e.stopPropagation();
        goRef.current('home');
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);

  // 自然滚动：向下滚，卡片组逐步升起（3D 全屏 → 半屏 → 升到顶），到顶后才开始滚清单；向上滚反过来。
  useEffect(() => {
    const el = shell.current!;
    let timer = 0,
      at: number | null = null;
    const wheel = (e: WheelEvent) => {
      const s = state.current;
      if (s.palette || s.allowed.length < 2 || e.ctrlKey) return;
      const min = s.stops[s.allowed[0]],
        max = s.stops[s.allowed[s.allowed.length - 1]],
        cur = at ?? s.live ?? s.stops[s.sheet];
      if (cur <= min + 0.5) {
        if (e.deltaY > 0) return;
        const scroller = (e.target as HTMLElement).closest?.('.card-scroll');
        if (scroller && scroller.scrollTop > 0) return;
      }
      e.preventDefault();
      at = Math.max(min, Math.min(max, cur - e.deltaY));
      setLive(at);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const y = at!,
          latest = state.current;
        at = null;
        setSheet(
          latest.allowed.reduce((a, b) =>
            Math.abs(latest.stops[b] - y) < Math.abs(latest.stops[a] - y) ? b : a,
          ),
        );
        setLive(null);
      }, 160);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', wheel);
      window.clearTimeout(timer);
    };
  }, []);
  // 模型里的文字标注（空间名、选中的记录名）每帧跟着相机投影。
  useEffect(() => {
    let raf = 0;
    const pool = new Map<string, HTMLElement>();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const box = labels.current,
        sc = scene.current;
      if (!box || !sc) return;
      const seen = new Set<string>();
      for (const l of world.labels()) {
        const p = sc.project(l.p);
        if (p.w <= 0) continue;
        seen.add(l.key);
        let el = pool.get(l.key);
        if (!el) {
          el = document.createElement('div');
          pool.set(l.key, el);
          box.appendChild(el);
        }
        el.className = `world-label ${l.kind}${l.on ? ' on' : ''}${l.dim ? ' dim' : ''}`;
        const html = `<b>${l.text}</b>` + (l.sub ? `<span>${l.sub}</span>` : '');
        if (el.dataset.html !== html) {
          el.dataset.html = html;
          el.innerHTML = html;
        }
        el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
      }
      for (const [key, el] of pool)
        if (!seen.has(key)) {
          el.remove();
          pool.delete(key);
        }
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      pool.forEach((el) => el.remove());
    };
  }, [world]);

  const info = places[place];
  return (
    <div
      className="shell"
      ref={shell}
      data-mode={work ? 'work' : 'home'}
      data-place={place}
      data-sheet={live === null ? sheet : 'moving'}
      data-own={world.view || undefined}
      style={{ '--deck-top': `${top}px`, '--deck-peek': `${stops.peek}px` } as React.CSSProperties}
    >
      <div className="shell-stage" ref={stage}>
        <EngineStage3D
          demo
          value={sim.value}
          samples={sim.samples}
          log={sim.log}
          attentionCount={0}
          reduced={reduced}
          hash=""
          channelNames={{ COLLECTION: '外部数据集', KNOWLEDGE: '内部资料库', RETRIEVAL: '外网数据集' }}
          onScene={(s) => {
            scene.current = s;
            world.attach(s);
            s?.setViewport(stops[sheet] / height, true);
          }}
        />
        <div className="world-labels" ref={labels} aria-hidden="true" />
      </div>

      <header className="shell-strip">
        <span className="mark" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 30 30">
            <ellipse
              cx="15"
              cy="15"
              rx="13"
              ry="5.4"
              fill="none"
              stroke="#f1d6a0"
              strokeWidth="1.2"
              transform="rotate(-32 15 15)"
            />
            <ellipse
              cx="15"
              cy="15"
              rx="13"
              ry="5.4"
              fill="none"
              stroke="#d6e2ee"
              strokeWidth="1.2"
              strokeDasharray="1.5 3"
              transform="rotate(32 15 15)"
            />
            <circle cx="15" cy="15" r="2.4" fill="#f1d6a0" />
          </svg>
        </span>
        <h1>{work ? info.name : '引擎'}</h1>
      </header>

      <div className="deck">
        <nav className="shell-switch" aria-label="引擎的各个部分">
          {SCENE.map((p) => (
            <button
              key={p}
              type="button"
              aria-current={place === p ? 'page' : undefined}
              onClick={() => go(p)}
            >
              <Icon name={p} />
              {places[p].name}
            </button>
          ))}
          <i aria-hidden="true" />
          {SETTINGS.map((p) => (
            <button
              key={p}
              type="button"
              className="quiet"
              aria-current={place === p ? 'page' : undefined}
              onClick={() => go(p)}
            >
              <Icon name={p} />
              {places[p].name}
            </button>
          ))}
          <i aria-hidden="true" />
          <button
            type="button"
            className="quiet"
            aria-label="搜索"
            title="搜索 ⌘K"
            onClick={() => setPalette(true)}
          >
            <Icon name="search" />
          </button>
        </nav>
        {place === 'usage' ? (
          <Usage />
        ) : place === 'data' ? (
          <DataWork
            picked={current(place)}
            pick={pick(place)}
            filter={filter[place] ?? 0}
            setFilter={(i) => setFilter((old) => ({ ...old, [place]: i }))}
            gate={gate}
            setGate={setGate}
          />
        ) : work ? (
          <Work
            key={place}
            place={place}
            picked={current(place)}
            pick={pick(place)}
            filter={filter[place] ?? 0}
            setFilter={(i) => setFilter((old) => ({ ...old, [place]: i }))}
            gate={null}
            setGate={setGate}
          />
        ) : (
          <Home go={go} />
        )}
      </div>

      {palette && <Palette go={go} close={() => setPalette(false)} />}
    </div>
  );
}

/** 每日请求柱状图：成功在下、失败与重试叠在上面。 */
function Bars({ label }: { label: string }) {
  const max = Math.max(...daily.map(([ok, bad]) => ok + bad));
  return (
    <div className="bars" role="img" aria-label={label}>
      {daily.map(([ok, bad], i) => (
        <span key={i} title={`10/${String(i + 1).padStart(2, '0')}：${ok + bad} 次，失败与重试 ${bad} 次`}>
          <i className="bad" style={{ height: `${((bad * 4) / max) * 100}%` }} />
          <i style={{ height: `${(ok / max) * 100}%` }} />
          <em>{i + 1}</em>
        </span>
      ))}
    </div>
  );
}

const StatCard = ({ c, go }: { c: (typeof homeCards)[number]; go: (p: Place) => void }) => (
  <button type="button" className="card stat" onClick={() => go(c.place)}>
    <span className="label">{c.label}</span>
    <span className="value">
      {c.value}
      <small>{c.unit}</small>
    </span>
    <span className="bar">
      <i style={{ width: `${c.ratio * 100}%` }} />
    </span>
    <span className="note">{c.note}</span>
  </button>
);

/** 引擎首页：待办、常用数据、每日请求和最近动态。半屏时只露出上面两行，卡片升到顶时一屏排完。 */
function Home({ go }: { go: (p: Place, id?: string) => void }) {
  return (
    <section className="cards home" aria-label="待办与常用数据">
      <article className="card todo">
        <header>
          <h2>需要你处理</h2>
          <span>{briefing.todos.length} 项，按影响排序</span>
        </header>
        <ol>
          {briefing.todos.map((t, i) => (
            <li key={t.id}>
              <button type="button" onClick={() => go(t.place, t.id)}>
                <span className="n">{i + 1}</span>
                <span className="t">
                  <b>{t.title}</b>
                  <span>{t.sub}</span>
                </span>
                <span className="tag">{places[t.place].name}</span>
                <span className="go">{t.act} →</span>
              </button>
            </li>
          ))}
        </ol>
      </article>
      {homeCards.slice(0, 4).map((c) => (
        <StatCard key={c.label} c={c} go={go} />
      ))}
      <article className="card chart">
        <header>
          <h2>本月每日引擎请求</h2>
          <span>10/01 – 10/12 · 共 8,584 次 · 成功率 98.8%</span>
        </header>
        <Bars label="本月每日引擎请求柱状图" />
      </article>
      <article className="card feed">
        <header>
          <h2>最近动态</h2>
          <button type="button" onClick={() => go('company')}>
            全部审计 →
          </button>
        </header>
        <div className="card-scroll">
          {activity.map(([time, who, what, tone], i) => (
            <p key={i}>
              <time>{time}</time>
              <b>{who}</b>
              <span className={tone === 'bad' ? 'tone-bad-text' : undefined}>{what}</span>
            </p>
          ))}
        </div>
      </article>
      {homeCards.slice(4).map((c) => (
        <StatCard key={c.label} c={c} go={go} />
      ))}
    </section>
  );
}

/** 用量与运行：读数、每日请求、用在了哪里、运行质量和额度。 */
function Usage() {
  return (
    <section className="cards usage" aria-label="用量与运行">
      {usage.readings.map(([label, value, note]) => (
        <article key={label} className="card stat">
          <span className="label">{label}</span>
          <span className="value">{value}</span>
          <span className="note">{note}</span>
        </article>
      ))}
      <article className="card chart">
        <header>
          <h2>每日引擎请求</h2>
          <span>本月 10/01 – 10/12 · 只统计已上报的部分</span>
        </header>
        <Bars label="每日引擎请求柱状图" />
      </article>
      <article className="card facts">
        <header>
          <h2>用在了哪里</h2>
        </header>
        {usage.parts.map(([label, value, share]) => (
          <div key={label} className="fact share">
            <span>{label}</span>
            <b>{value}</b>
            <i>
              <i style={{ width: `${share}%` }} />
            </i>
          </div>
        ))}
      </article>
      <article className="card facts">
        <header>
          <h2>运行质量</h2>
        </header>
        {usage.quality.map(([label, value, tone]) => (
          <div key={label} className="fact">
            <span>{label}</span>
            <b className={`tone-${tone}-text`}>{value}</b>
          </div>
        ))}
        <header>
          <h2>本月额度</h2>
        </header>
        <div className="fact share">
          <span>{usage.quota.note}</span>
          <b>
            {usage.quota.used} / {usage.quota.total}
          </b>
          <i>
            <i style={{ width: `${usage.quota.ratio * 100}%` }} />
          </i>
        </div>
      </article>
    </section>
  );
}

const toneClass = (t: Tone) => `tone-${t}`;

function Work({
  place,
  picked,
  pick,
  filter,
  setFilter,
  gate,
  setGate,
}: {
  place: Place;
  picked: string;
  pick: (id: string) => void;
  filter: number;
  setFilter: (i: number) => void;
  gate: number | null;
  setGate: (gate: number | null) => void;
}) {
  const info = places[place],
    side = stats[place],
    more = aside[place],
    tab = tabs[place][filter] || tabs[place][0],
    all = tabs[place].flatMap((x) => x.items);
  const shown = tab.items.filter(
    (x) => gate === null || (GATE_OF[x.id] === gate && x.tone !== 'ok' && x.tone !== 'run'),
  );
  const current = all.find((x) => x.id === picked) || shown[0] || tab.items[0];
  const groups = shown.reduce<[string, Item[]][]>((acc, x) => {
    const g = acc.find(([name]) => name === x.group);
    if (g) g[1].push(x);
    else acc.push([x.group, [x]]);
    return acc;
  }, []);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current?.id]);
  // ↑↓ 在清单里换行，不离开键盘。
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = shown.findIndex((x) => x.id === current.id);
    const next = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    pick(next.id);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus());
  };
  const flow = place === 'data' ? steps[current.id] : undefined;
  const links = place === 'knowledge' ? related(current.id) : [];
  return (
    <section className="cards work" aria-label={info.name}>
      <article className="card list">
        <div className="tabs" role="tablist" aria-label={`${info.name}栏目`}>
          {tabs[place].map((f, i) => (
            <button
              key={f.label}
              type="button"
              role="tab"
              aria-selected={filter === i}
              onClick={() => {
                setFilter(i);
                if (f.items[0]) pick(f.items[0].id);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="card-scroll" ref={list} onKeyDown={move}>
          {gate !== null && (
            <button type="button" className="chip" onClick={() => setGate(null)}>
              只看卡在“{GATES[gate]}”的 ×
            </button>
          )}
          {groups.length === 0 && <p className="none">这一栏里没有符合条件的记录。</p>}
          {groups.map(([name, items]) => (
            <div key={name}>
              <h3>
                {name} <span>{items.length}</span>
              </h3>
              {items.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className="row"
                  aria-pressed={x.id === current.id}
                  onClick={() => pick(x.id)}
                >
                  <i className={toneClass(x.tone)} />
                  <span className="t">
                    <b>{x.name}</b>
                    <span className={x.tone === 'bad' ? 'tone-bad-text' : undefined}>{x.why}</span>
                  </span>
                  <span className="s">{x.side}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </article>

      <article className="card detail" aria-live="polite">
        <header>
          <h2>{current.name}</h2>
          <span>
            {current.group}
            {current.side && ` · ${current.side}`}
          </span>
        </header>
        <div className="card-scroll">
          <p className={`verdict ${toneClass(current.tone)}`}>{current.verdict}</p>
          {flow && (
            <ol className="flow">
              {flow.map(([text, state], i) => (
                <li key={i} data-state={state}>
                  <b>{STEP_NAMES[i]}</b>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
          )}
          {current.kv.length > 0 && (
            <table>
              <thead>
                <tr>
                  {current.kvHead.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {current.kv.map(([a, b, c, tone]) => (
                  <tr key={a}>
                    <th>{a}</th>
                    <td>{b}</td>
                    <td className={`${toneClass(tone)}-text`}>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {place === 'knowledge' && (
            <div className="related">
              <h3>关联知识 {links.length}</h3>
              {links.map((r) => (
                <button key={r.id} type="button" onClick={() => pick(r.id)}>
                  <b>{r.name}</b>
                  <span>{r.why}</span>
                </button>
              ))}
              {links.length === 0 && <p>这条知识目前没有关联。</p>}
            </div>
          )}
        </div>
        {current.actions.length > 0 && (
          <footer>
            {current.actions.map((a, i) => (
              <button key={a} type="button" className={i === 0 ? 'primary' : undefined}>
                {a}
              </button>
            ))}
          </footer>
        )}
      </article>

      <div className="side">
        <article className="card facts">
          <header>
            <h2>{side.title}</h2>
          </header>
          {side.rows.map(([label, value, note], i) =>
            place === 'data' && note ? (
              <button
                key={label}
                type="button"
                className="fact"
                aria-pressed={gate === i}
                onClick={() => setGate(gate === i ? null : i)}
              >
                <span>{label}</span>
                <b>{value}</b>
                <small>{note}</small>
              </button>
            ) : (
              <div key={label} className="fact">
                <span>{label}</span>
                <b>{value}</b>
                {note && <small>{note}</small>}
              </div>
            ),
          )}
        </article>
        <article className="card facts more">
          <header>
            <h2>{more.title}</h2>
          </header>
          {more.rows.map(([label, value, tone]) => (
            <div key={label} className="fact line">
              <span>{label}</span>
              <small className={tone ? `tone-${tone}-text` : undefined}>{value}</small>
            </div>
          ))}
        </article>
      </div>
    </section>
  );
}

function Palette({ go, close }: { go: (p: Place, id?: string) => void; close: () => void }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const all = useMemo(
    () => [
      ...(Object.keys(places) as Place[]).map((p) => ({
        place: p,
        id: undefined as string | undefined,
        label: places[p].name,
        sub: '前往',
      })),
      ...(Object.keys(places) as Place[]).flatMap((p) =>
        places[p].items.map((x) => ({
          place: p,
          id: x.id as string | undefined,
          label: x.name,
          sub: `${places[p].name} · ${x.why}`,
        })),
      ),
    ],
    [],
  );
  const hits = all
    .filter((x) => !q.trim() || (x.label + x.sub).toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8);
  const index = Math.min(at, Math.max(0, hits.length - 1));
  return (
    <div className="palette" role="dialog" aria-label="搜索" onClick={close}>
      <div onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          placeholder="搜数据、知识、经验、成员，或输入要去的地方"
          aria-label="搜索"
          onChange={(e) => {
            setQ(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') (e.preventDefault(), setAt(Math.min(hits.length - 1, index + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setAt(Math.max(0, index - 1)));
            else if (e.key === 'Enter' && hits[index]) go(hits[index].place, hits[index].id);
          }}
        />
        <ul>
          {hits.map((x, i) => (
            <li key={x.place + (x.id || '')}>
              <button
                type="button"
                aria-selected={i === index}
                onMouseEnter={() => setAt(i)}
                onClick={() => go(x.place, x.id)}
              >
                <b>{x.label}</b>
                <span>{x.sub}</span>
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="none">没有找到“{q}”</li>}
        </ul>
      </div>
    </div>
  );
}

/** 导航图标：同一套 1.5 线宽的细线图形。 */
const ICONS: Record<Place | 'search', React.ReactNode> = {
  home: (
    <>
      <circle cx="12" cy="12" r="3" />
      <ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-28 12 12)" />
    </>
  ),
  data: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
      <path d="M5 6v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 12v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-6" />
    </>
  ),
  knowledge: (
    <>
      <circle cx="6" cy="7" r="2.2" />
      <circle cx="18" cy="9" r="2.2" />
      <circle cx="11" cy="18" r="2.2" />
      <path d="M8.1 7.5l7.8 1.1M7 9l3 7M16.6 10.7l-4.2 5.6" />
    </>
  ),
  experience: (
    <>
      <path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L19.5 9M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4.5 15" />
      <path d="M19.5 4.5V9H15M4.5 19.5V15H9" />
    </>
  ),
  output: (
    <>
      <path d="M13 5h6v6M19 5l-8.5 8.5" />
      <path d="M10 6H6.5A1.5 1.5 0 0 0 5 7.5v10A1.5 1.5 0 0 0 6.5 19h10a1.5 1.5 0 0 0 1.5-1.5V14" />
    </>
  ),
  members: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14.3c2.1.7 3.5 2.6 3.5 5.2" />
    </>
  ),
  usage: <path d="M3 12.5h4l2.5-7 4 13 2.5-6h5" />,
  company: (
    <>
      <path d="M5 20.5V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5v15M15 10h3.5A1.5 1.5 0 0 1 20 11.5v9M3 20.5h18" />
      <path d="M8.5 8h3M8.5 12h3M8.5 16h3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.500" />
      <path d="M20 20l-4-4" />
    </>
  ),
};
function Icon({ name }: { name: Place | 'search' }) {
  return (
    <svg
      className="ico"
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}
