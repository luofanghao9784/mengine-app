import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EngineStage3D } from '../../operations/engine-stage/EngineStage3D';
import { busyDemo } from '../../operations/engine-demo';
import { OutputWork } from './BusinessWork';
import { useSceneRuntime, disconnectedTelemetry, type SceneRuntime } from './runtime';
import { requestNavigationLocked } from '../../shared/request-guard';
import type { EngineScene, Focus } from '../../operations/engine-stage/scene';
import { BackgroundKnowledge } from '../../profile/BackgroundKnowledge';
import { DataWork } from './DataWork';
import { revealInList, useProgressive } from './AssetBits';
import { KnowledgeListRow } from './KnowledgeListRow';
import { useSession } from '../../identity/session';
import { AccessWork } from './AccessWork';
import { useFoundation, asItem, type Foundation } from './foundation-api';
import { activity, aside, daily, steps, STEP_NAMES, tabs, usage } from './content';
import { homeCards, places, stats, type Item, type Place, type Tone } from './data';
import { useKnowledge, type Knowledge } from './knowledge-api';
import { api } from './foundation-api';
import { GATES, GATE_OF, World, type WorldLabel } from './world';
import { LabelLayout, type LabelBox } from './label-layout';
import { MembersWork } from './MembersWork';
import { UsageWork } from './UsageWork';
import { CompanyWork } from './CompanyWork';
import { ExperienceWork } from './ExperienceWork';
import { scenePlace, sceneTenant, setSceneTenant, writeScenePlace } from './scene-route';
import './scene-shell.css';
import './glass-theme.css';

/**
 * 原型：企业管理端的“场景外壳”。没有侧边栏和页面，整个管理端是一个铺满窗口的 3D 引擎模型，
 * 内容是浮在模型上的一组深色玻璃卡片。
 * - 数据基座、知识星链和引擎是同一个模型：切换板块 = 同一台相机移到模型的另一处。
 * - 卡片组有三档：升到顶（专心处理）、半屏、降到底（3D 全屏）。上下滚动自然地在三档之间过渡（没有拖动拉手）。
 * - 导航是一条独立的深色栏，挂在卡片组上方，跟着卡片一起上下滑动；卡片升到顶时它正好在最顶部。
 */
const MemoDataWork = memo(DataWork);
const MemoMembersWork = memo(MembersWork);
const MemoUsageWork = memo(UsageWork);
const MemoCompanyWork = memo(CompanyWork);
const MemoExperienceWork = memo(ExperienceWork);
const MemoWork = memo(Work);
const SCENE: Place[] = ['home', 'data', 'knowledge', 'experience'];
const SETTINGS: Place[] = ['members', 'usage', 'company'];
const SHORTCUT: Partial<Record<Place, string>> = { data: '1', knowledge: '2', experience: '4' };
type Sheet = 'peek' | 'half' | 'full';
const ORDER: Sheet[] = ['peek', 'half', 'full'];
const press = (key: string) =>
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
const typing = (e: Event) =>
  !!(e.target as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable]');

/** 知识同步是写操作，只在这里手动开始：有待整理的资料或待确认的关联时才出现。 */
function KnowledgeSync({ knowledge }: { knowledge: Knowledge }) {
  const d = knowledge.data;
  if (!d?.available) return null;
  const waiting = d.pending + d.failed;
  if (!knowledge.busy && !d.busy && !waiting && !d.needsGraph) return null;
  return (
    <p className="knowledge-sync" role="status">
      <span>
        {knowledge.busy || d.busy
          ? '正在同步知识与关联…'
          : [d.pending && `${d.pending} 份资料待整理`, d.failed && `${d.failed} 份上次失败`, d.needsGraph && '关联待分析']
              .filter(Boolean)
              .join(' · ')}
      </span>
      <button type="button" disabled={knowledge.busy || d.busy} onClick={() => void knowledge.sync(d.failed > 0)}>
        开始同步
      </button>
    </p>
  );
}

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

export function SceneShell({ tenant = null }: { tenant?: string | null }) {
  const { session } = useSession();
  setSceneTenant(tenant);
  const enterpriseName = session.identity?.memberships.find(m => m.tenantId === tenant)?.tenantName;
  const runtime = useSceneRuntime(tenant);
  const reduced = useReduced();
  const foundation = useFoundation();
  const [now, setNow] = useState(() => Date.now());
  // 时钟只驱动无企业时的演示数据；接入企业后不再每 3 秒重绘整页。
  useEffect(() => {
    if (tenant) return;
    const t = window.setInterval(() => setNow(Date.now()), 3000);
    return () => window.clearInterval(t);
  }, [tenant]);
  const sim = useMemo(
    () =>
      tenant
        ? {
            value: runtime.value || disconnectedTelemetry(tenant),
            samples: runtime.samples,
            log: runtime.log,
          }
        : busyDemo(now),
    [tenant, runtime.value, runtime.samples, runtime.log, now],
  );

  // 当前板块以地址里的 place 为准：刷新回原处；没写时接入企业默认进数据基座。
  const [place, setPlace] = useState<Place>(() => scenePlace() ?? (tenant ? 'data' : 'home'));
  const [sheet, setSheet] = useState<Sheet>(() => (SCENE.includes(place) ? 'half' : 'peek'));
  const [picked, setPicked] = useState<Partial<Record<Place, string>>>({});
  const [filter, setFilter] = useState<Partial<Record<Place, number>>>({});
  const [gate, setGate] = useState<number | null>(null);
  const [palette, setPalette] = useState(false);
  const [height, setHeight] = useState(() => window.innerHeight);
  const [width, setWidth] = useState(() => window.innerWidth);
  /** 滚动过程中卡片组顶边的实时位置；null 表示停在某一档上。 */
  const [live, setLive] = useState<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  /** 顶部标题栏：标注不能排到它下面去。 */
  const strip = useRef<HTMLElement>(null);
  const nav = useRef<HTMLElement>(null);
  /** 导航里当前板块的实心滑块：位置跟着当前项走，切换时滑过去。 */
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const scene = useRef<EngineScene | null>(null);
  const knowledge = useKnowledge(place === 'knowledge', tenant);
  const world = useMemo(() => new World([], [], [], {}), []);
  useEffect(() => {
    world.setKnowledge(
      knowledge.data?.items || [],
      knowledge.data?.relations || [],
      knowledge.data?.sourceKind || {},
    );
  }, [world, knowledge.data]);

  useEffect(() => {
    world.setFoundation(
      (foundation.data?.items || []).map((a) => ({ ...asItem(a), gate: a.gate, sourceKind: a.sourceKind })),
      foundation.data ? GATES.map((_, stage) => foundation.data!.items.filter(a => a.gate === stage).length) : null,
      foundation.data?.sources || [],
    );
  }, [world, foundation.data]);

  const hasScene = (p: Place) => SCENE.includes(p);
  const work = place !== 'home';
  /** 有 3D 的板块之间切换时保持的面板位置；去没有 3D 的页面再回来，也回到这一档。 */
  const sceneSheet = useRef<Sheet>('half');
  const allowed: Sheet[] = hasScene(place) ? ORDER : ['peek'];
  const stops: Record<Sheet, number> = {
    // 窄窗口时导航退到第二行，卡片升到顶也要让开它。
    peek: width < 1180 ? 58 : 4,
    half: Math.round(height * 0.6),
    full: height - 66,
  };
  const top = live ?? stops[sheet];
  const state = useRef({ place, sheet, palette, allowed, stops, live });
  state.current = { place, sheet, palette, allowed, stops, live };

  useEffect(() => {
    const on = () => {
      setHeight(window.innerHeight);
      setWidth(window.innerWidth);
    };
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  // 卡片组顶边的位置直接写进样式变量：滚动过程中逐帧更新它，不让整页随每个滚轮事件重绘。
  const paintTop = (y: number) => {
    const el = shell.current;
    if (!el) return;
    el.style.setProperty('--deck-top', `${y}px`);
    el.style.setProperty(
      '--header-haze',
      String(Math.max(0, Math.min(1, 1 - (y - state.current.stops.peek) / 160))),
    );
  };
  // 卡片组升到顶时 3D 整个被盖住：停掉 3D 渲染和标注投影，只留最后一帧。
  const paused = live === null && sheet === 'peek';
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => scene.current?.setPaused(paused), [paused]);
  const paintTopRef = useRef(paintTop);
  paintTopRef.current = paintTop;
  // live 从数值回到 null（一次滑动结束）时也要重写一次，免得停在最后一帧手动写入的位置。
  useLayoutEffect(() => paintTop(top), [top, live, stops.peek]);
  // 画布始终铺满窗口，卡片盖住下半部分；告诉场景“可见的是上面这一截”，它会把画面收进去，不用重建画布。
  useEffect(() => scene.current?.setViewport(top / height, live !== null), [top, height, live]);

  const current = (p: Place) =>
    picked[p] ||
    (p === 'data'
      ? ''
      : p === 'knowledge'
        ? knowledge.tabs[filter[p] ?? 0]?.items[0]?.id || ''
        : (tabs[p][filter[p] ?? 0]?.items ?? places[p].items)[0]?.id || '');
  const pick = (p: Place) => (id: string) => setPicked((old) => ({ ...old, [p]: id }));
  world.view = place === 'data' || place === 'knowledge' ? place : null;
  world.overview = place === 'home';
  world.selected = world.view ? current(place) : '';
  world.gate = place === 'data' ? gate : null;
  world.onPick = (id) => {
    if (place === 'knowledge') setFilter((old) => ({ ...old, knowledge: 0 }));
    pick(place)(id);
  };
  world.onGate = (next) => {
    setGate(next);
    setFilter((old) => ({ ...old, data: 2 }));
    setPicked((old) => ({ ...old, data: '' }));
  };

  const sceneFocus = () =>
    (stage.current?.querySelector('.eng3d')?.getAttribute('data-focus') || null) as Focus;
  const go = (next: Place, id?: string) => {
    if (next === 'output' || requestNavigationLocked()) return;
    if (id) {
      setPicked((old) => ({ ...old, [next]: id }));
      if (next === 'knowledge') setFilter((old) => ({ ...old, knowledge: 0 }));
      if (next === 'data') {
        setFilter((old) => ({ ...old, data: 2 }));
        setGate(null);
      }
    }
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
  // 板块写进地址：首次打开只补上 place，不新增历史记录；之后每次切换算一条，浏览器后退可用。
  const routed = useRef(false);
  useEffect(() => {
    writeScenePlace(place, !routed.current);
    routed.current = true;
  }, [place]);
  // 标签页标题跟着板块走（嵌在板块里的旧版管理台会改标题，离开后要改回来）。
  useEffect(() => {
    if (tenant) document.title = `${places[place].name} · ${enterpriseName || ''}企业管理`;
  }, [tenant, place, enterpriseName]);
  // 后退、前进或手动改地址：按地址里的板块切过去。
  useEffect(() => {
    const change = () => {
      const next = scenePlace();
      if (next && next !== state.current.place) goRef.current(next);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  // 刷新时直接落在经验库这类要聚焦 3D 某一段的板块：让舞台也转过去。
  useEffect(() => {
    const at = state.current.place;
    if (places[at].focus && sceneFocus() !== places[at].focus) press(SHORTCUT[at]!);
  }, []);
  world.onNavigate = (next) => goRef.current(next);
  // 传给工作卡片的回调保持同一个引用，运行状态轮询重绘外壳时，清单和详情不跟着重算。
  const goStable = useCallback((next: Place, id?: string) => goRef.current(next, id), []);
  const toCompany = useCallback(() => goRef.current('company'), []);
  const pickHere = useMemo(() => pick(place), [place]);
  const setFilterHere = useCallback((i: number) => setFilter((old) => ({ ...old, [place]: i })), [place]);
  // 在引擎舞台里直接点某一段也算一次切换：点输入车道 = 去数据基座；点自进化轨道 = 去经验库；输出板块暂不展示。
  useEffect(() => {
    const el = stage.current?.querySelector('.eng3d');
    if (!el) return;
    const observer = new MutationObserver(() => {
      const f = el.getAttribute('data-focus') as Focus;
      const at = state.current.place;
      if (f === 'in') goRef.current('data');
      else if (f === 'evo' && at !== 'experience') setPlace('experience');
      else if (!f && places[at].focus) setPlace('home');
    });
    observer.observe(el, { attributes: true, attributeFilter: ['data-focus'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    // 抢在舞台自己的快捷键之前：1、2 去数据基座和知识星链（舞台原本会把它们当作“输入”“处理”）。
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
      idle = 0,
      edge = 0,
      at: number | null = null,
      // 一次滑动手势（含触控板惯性）只做一件事：滚卡片内容，或切换三档；停顿 260ms 算新的一次。
      gesture: 'content' | 'sheet' | 'edge' | null = null;
    const EDGE_PULL = 90; // 内容滚到头后，新的一次手势要多滑这么多才切换三档，避免误触
    const wheel = (e: WheelEvent) => {
      const s = state.current;
      if (s.palette || s.allowed.length < 2 || e.ctrlKey) return;
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        gesture = null;
        edge = 0;
      }, 260);
      if (gesture === 'content') return;
      const min = s.stops[s.allowed[0]],
        max = s.stops[s.allowed[s.allowed.length - 1]],
        cur = at ?? s.live ?? s.stops[s.sheet];
      if (gesture === null) {
        const scroller = (e.target as HTMLElement).closest?.('.card-scroll, .src-list') as HTMLElement | null;
        if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
          const atTop = scroller.scrollTop <= 0,
            atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
          // 还能往这个方向滚：这一整次手势都交给内容。
          if (e.deltaY > 0 ? !atBottom : !atTop) {
            gesture = 'content';
            return;
          }
          gesture = 'edge';
        } else gesture = 'sheet';
      }
      // 卡片组已经在最高处，再往下滑没有可切换的了。
      if (cur <= min + 0.5 && e.deltaY > 0) return;
      if (gesture === 'edge') {
        e.preventDefault();
        edge += Math.abs(e.deltaY);
        if (edge < EDGE_PULL) return;
        gesture = 'sheet';
      }
      e.preventDefault();
      const moving = at !== null || s.live !== null;
      at = Math.max(min, Math.min(max, cur - e.deltaY));
      // 只在一次滑动开始时进入“移动中”状态；之后逐帧直接改样式和场景视口。
      if (!moving) setLive(at);
      else {
        paintTopRef.current(at);
        scene.current?.setViewport(at / window.innerHeight, true);
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const y = at!,
          latest = state.current;
        at = null;
        const snap = latest.allowed.reduce((a, b) =>
          Math.abs(latest.stops[b] - y) < Math.abs(latest.stops[a] - y) ? b : a,
        );
        setSheet(snap);
        setLive(null);
      }, 160);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', wheel);
      window.clearTimeout(timer);
      window.clearTimeout(idle);
    };
  }, []);
  // 模型里的文字标注（空间名、选中的记录名）每帧跟着相机投影。
  useEffect(() => {
    let raf = 0;
    let lastView = world.view;
    let knowledgeLabelsReady = false;
    /** 标注开始淡入的时刻：此后一小段时间内新出现的标注按重要程度依次错开淡入。 */
    let arrivedAt = 0;
    const pool = new Map<string, HTMLElement>();
    // 每个标注上一次写入的内容和位置：没变就不碰 DOM，免得每帧都触发样式重算。
    const written = new Map<string, { cls: string; x: number; y: number }>();
    const sizes = new Map<string, { sig: string; w: number; h: number }>();
    const layout = new LabelLayout();
    // 标题栏的下沿：只在尺寸变化时量一次，不在每帧里读布局。
    let titleBottom = 52;
    const measureTitle = () => {
      const el = strip.current;
      if (el) titleBottom = el.getBoundingClientRect().bottom + 8;
    };
    measureTitle();
    const titleObserver = new ResizeObserver(measureTitle);
    if (strip.current) titleObserver.observe(strip.current);
    window.addEventListener('resize', measureTitle);
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const box = labels.current,
        sc = scene.current;
      if (!box || !sc || pausedRef.current) return;
      // 被卡片组盖住或在窗口外的标注不画：知识节点多时，只排看得见的那些。
      const deckTop = parseFloat(shell.current?.style.getPropertyValue('--deck-top') || '') || window.innerHeight;
      const right = window.innerWidth + 80;
      if (lastView !== world.view) {
        lastView = world.view;
        knowledgeLabelsReady = false;
        layout.reset();
      }
      if (world.view === 'knowledge' && !knowledgeLabelsReady) {
        knowledgeLabelsReady = world.knowledgeSettled();
        if (knowledgeLabelsReady) arrivedAt = performance.now();
      }
      const seen = new Set<string>();
      const nodes: { l: WorldLabel; el: HTMLElement; x: number; y: number; cls: string }[] = [];
      for (const l of world.labels()) {
        const p = sc.project(l.p);
        if (p.w <= 0 || p.x < -80 || p.x > right || p.y < -40 || p.y > deckTop) continue;
        seen.add(l.key);
        let el = pool.get(l.key);
        if (!el) {
          el = document.createElement('div');
          pool.set(l.key, el);
          box.appendChild(el);
        }
        const before = written.get(l.key);
        const cls = `world-label ${l.kind}${l.on ? ' on' : ''}${l.dim ? ' dim' : ''}${l.kind === 'node' && !knowledgeLabelsReady ? ' arriving' : ''}`;
        const html = l.sub ? `${l.text}\u0000${l.sub}` : l.text;
        if (el.dataset.html !== html) {
          el.dataset.html = html;
          const title = document.createElement('b');
          title.textContent = l.text;
          el.replaceChildren(title);
          if (l.sub) {
            const sub = document.createElement('span');
            sub.textContent = l.sub;
            el.appendChild(sub);
          }
        }
        // 知识节点先收集起来统一排位；其他标注照原样跟着光点走。
        if (l.kind === 'node') {
          nodes.push({ l, el, x: p.x, y: p.y, cls });
          continue;
        }
        if (before?.cls !== cls) el.className = cls;
        const moved = !before || Math.abs(before.x - p.x) >= 0.3 || Math.abs(before.y - p.y) >= 0.3;
        if (moved) el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
        written.set(l.key, { cls, x: moved ? p.x : before.x, y: moved ? p.y : before.y });
      }
      if (nodes.length) {
        // 先写好文字和样式，再一次性量尺寸（只量变过的），最后排位。
        for (const n of nodes) {
          const prev = written.get(n.l.key);
          // 新出现的标注先藏着，等排好位再淡入。
          const want = n.cls + (!prev || prev.cls.endsWith(' off') ? ' off' : '');
          if (n.el.className !== want) n.el.className = want;
        }
        const boxes: LabelBox[] = [];
        for (const n of nodes) {
          if (n.l.hidden) continue;
          const sig = n.cls + '|' + (n.el.dataset.html || '');
          let size = sizes.get(n.l.key);
          if (size?.sig !== sig) {
            size = { sig, w: n.el.offsetWidth, h: n.el.offsetHeight };
            sizes.set(n.l.key, size);
          }
          boxes.push({ key: n.l.key, x: n.x, y: n.y, w: size.w, h: size.h, rank: n.l.rank ?? 0 });
        }
        // 密度上限：除选中、悬停外，大约每 4.5 万平方像素一个标注（与焦点相连的优先）。
        const area = window.innerWidth * Math.max(0, deckTop - titleBottom);
        const placed = layout.place(
          boxes,
          { left: 4, top: titleBottom, right: window.innerWidth - 4, bottom: deckTop - 4 },
          Math.max(6, Math.round(area / 45000)),
        );
        // 刚到达时按重要程度依次淡入，而不是一起冒出来。
        const staggering = performance.now() - arrivedAt < 1200;
        let order = 0;
        if (staggering) nodes.sort((a, b) => (b.l.rank ?? 0) - (a.l.rank ?? 0));
        for (const n of nodes) {
          const at = n.l.hidden ? null : placed.get(n.l.key);
          const cls = n.cls + (at ? '' : ' off');
          const before = written.get(n.l.key);
          if (before?.cls !== cls) {
            const appearing =
              !!at && (!before || before.cls.endsWith(' off') || before.cls.includes(' arriving'));
            n.el.style.transitionDelay = appearing && staggering ? `${Math.min(order++ * 45, 600)}ms` : '';
            n.el.className = cls;
          }
          if (at) {
            const moved = !before || Math.abs(before.x - at.left) >= 0.3 || Math.abs(before.y - at.top) >= 0.3;
            if (moved) n.el.style.transform = `translate3d(${at.left.toFixed(1)}px,${at.top.toFixed(1)}px,0)`;
            written.set(n.l.key, { cls, x: moved ? at.left : before.x, y: moved ? at.top : before.y });
          } else written.set(n.l.key, { cls, x: before?.x ?? -1e4, y: before?.y ?? -1e4 });
        }
      }
      for (const [key, el] of pool)
        if (!seen.has(key)) {
          el.remove();
          pool.delete(key);
          written.delete(key);
          sizes.delete(key);
        }

    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      pool.forEach((el) => el.remove());
      written.clear();
      titleObserver.disconnect();
      window.removeEventListener('resize', measureTitle);
    };
  }, [world]);

  useLayoutEffect(() => {
    const on = nav.current?.querySelector<HTMLElement>('button[aria-current="page"]');
    setPill(on ? { x: on.offsetLeft, w: on.offsetWidth } : null);
  }, [place, width]);

  const info = places[place];
  return (
    <div
      className="shell"
      ref={shell}
      data-runtime={tenant && !runtime.value ? 'unavailable' : 'ready'}
      data-mode={work ? 'work' : 'home'}
      data-place={place}
      data-sheet={live === null ? sheet : 'moving'}
      data-own={world.view || undefined}
      style={{ '--deck-peek': `${stops.peek}px` } as React.CSSProperties}
    >
      <div
        className="shell-stage"
        ref={stage}
        onClickCapture={(event) => {
          const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
          const href = link?.getAttribute('href');
          if (!tenant || !href?.startsWith('#')) return;
          const target = new URLSearchParams(href.slice(1)).get('admin');
          if (target === 'usage' || target === 'database') {
            event.preventDefault();
            go(target === 'usage' ? 'usage' : 'data');
          }
        }}
      >
        <EngineStage3D
          demo={!tenant}
          value={sim.value}
          samples={sim.samples}
          log={sim.log}
          attentionCount={0}
          reduced={reduced}
          hash=""
          channelNames={
            tenant
              ? undefined
              : { COLLECTION: '外部数据集', KNOWLEDGE: '内部资料库', RETRIEVAL: '外网数据集' }
          }
          onScene={(s) => {
            scene.current = s;
            world.attach(s);
            s?.setViewport(stops[sheet] / height, true);
            s?.setPaused(pausedRef.current);
          }}
        />
        {tenant && !runtime.value && (
          <p className="runtime-notice" role="status">
            {runtime.error || '正在读取企业运行状态…'}
          </p>
        )}
        <div className="world-labels" ref={labels} aria-hidden="true" />
      </div>

      <div className="shell-header-haze" aria-hidden="true" />
      <header className="shell-strip" ref={strip}>
        {enterpriseName && <span className="shell-enterprise-name" title={enterpriseName}>{enterpriseName}</span>}
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
        <h1>{work ? info.name : '引擎概览'}</h1>
        <span className="live-state">
          {place === 'data'
            ? foundation.data
              ? `资产 ${foundation.data.items.length} · 待处理 ${foundation.data.governance.attention} · 隔离 ${foundation.data.governance.isolated} 项 · 平均质量 ${foundation.data.governance.averageQuality ?? '—'}`
              : '数据基座 · 等待连接'
            : place === 'knowledge'
              ? '知识星链 · ' +
                (knowledge.error || (knowledge.busy ? '正在同步' : knowledge.data?.status || '等待连接'))
              : tenant
                ? ''
                : '引擎与其他板块为演示 · 数据基座与知识星链已接入'}
        </span>
      </header>

      <div className="deck">
        <nav className="shell-switch" aria-label="引擎的各个部分" ref={nav}>
          {pill && (
            <span
              className="switch-pill"
              aria-hidden="true"
              style={{ transform: `translateX(${pill.x}px)`, width: pill.w }}
            />
          )}
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
        {tenant && place === 'members' ? (
          <MemoMembersWork key={tenant} tenant={tenant} />
        ) : tenant && place === 'usage' ? (
          <MemoUsageWork key={tenant} tenant={tenant} />
        ) : tenant && place === 'company' ? (
          <MemoCompanyWork key={tenant} tenant={tenant} />
        ) : tenant && place === 'experience' ? (
          <MemoExperienceWork key={tenant} tenant={tenant} />
        ) : tenant && place === 'output' ? (
          <OutputWork tenant={tenant} />
        ) : place === 'members' ? (
          <AccessWork />
        ) : place === 'usage' ? (
          <Usage />
        ) : place === 'data' ? (
          <MemoDataWork
            tenant={tenant}
            onMaintainBackground={toCompany}
            foundation={foundation}
            picked={current(place)}
            pick={pickHere}
            filter={filter[place] ?? 2}
            setFilter={setFilterHere}
            gate={gate}
            setGate={setGate}
          />
        ) : work ? (
          <MemoWork
            tenant={tenant}
            onBackgroundSource={toCompany}
            key={place}
            knowledge={knowledge}
            place={place}
            picked={current(place)}
            pick={pickHere}
            filter={filter[place] ?? 0}
            setFilter={setFilterHere}
            gate={null}
            setGate={setGate}
          />
        ) : (
          <Home
            go={goStable}
            foundation={foundation}
            knowledge={knowledge}
            runtime={tenant ? runtime : undefined}
          />
        )}
      </div>


      {palette && (
        <Palette knowledge={knowledge} foundation={foundation} go={go} close={() => setPalette(false)} />
      )}
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
function Home({
  runtime,
  go,
  foundation,
  knowledge,
}: {
  go: (p: Place, id?: string) => void;
  runtime?: SceneRuntime;
  foundation: Foundation;
  knowledge: Knowledge;
}) {
  const assets = foundation.data?.items || [];
  const todos = assets
    .filter((x) => x.needsAttention)
    .slice(0, 8)
    .map((x) => ({ id: x.id, title: x.title, sub: x.label, place: 'data' as Place, act: '查看' }));
  const cards = homeCards.filter(c => c.place !== 'output').map((c) =>
    c.place === 'data'
      ? {
          ...c,
          value: foundation.data ? String(assets.filter((x) => x.available).length) : '—',
          unit: foundation.data ? `/ ${assets.filter((x) => x.status !== 'archived').length} 可用` : '',
          note: foundation.data ? '当前企业数据基座' : '登录数据基座后查看',
          ratio: assets.length ? assets.filter((x) => x.available).length / assets.length : 0,
        }
      : c.place === 'knowledge'
        ? {
            ...c,
            value: knowledge.data ? String(knowledge.data.items.length) : '—',
            unit: '条',
            ratio: 0,
            note: knowledge.error || knowledge.data?.status || '读取当前企业知识',
          }
        : runtime
          ? { ...c, value: '—', unit: '', ratio: 0, note: '打开查看获权内容' }
          : c,
  );

  return (
    <section className="cards home glass" aria-label="待办与常用数据">
      <article className="card todo">
        <header>
          <h2>需要你处理</h2>
          <span>{todos.length} 项，按影响排序</span>
        </header>
        <ol>
          {todos.map((t, i) => (
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
      {cards.slice(0, 4).map((c) => (
        <StatCard key={c.label} c={c} go={go} />
      ))}
      <article className="card chart">
        <header>
          <h2>本月每日引擎请求</h2>
          <span>
            {runtime
              ? runtime.usage
                ? `${runtime.usage.days.reduce((n, d) => n + d.workRequests, 0)} 次工作请求 · 本月`
                : runtime.usageError || '正在读取用量…'
              : '10/01 – 10/12 · 共 8,584 次 · 成功率 98.8%'}
          </span>
        </header>
        {runtime ? (
          <div className="bars" role="img" aria-label="本月每日工作请求">
            {runtime.usage?.days.map((d) => (
              <span key={d.date} title={`${d.date}：${d.workRequests} 次工作请求`}>
                <i
                  style={{
                    height: `${(d.workRequests / Math.max(1, ...runtime.usage!.days.map((x) => x.workRequests))) * 100}%`,
                  }}
                />
                <em>{Number(d.date.slice(-2))}</em>
              </span>
            ))}
          </div>
        ) : (
          <Bars label="本月每日引擎请求柱状图" />
        )}
      </article>
      <article className="card feed">
        <header>
          <h2>{runtime ? '运行变化 · 本页观测' : '最近动态 · 演示'}</h2>
          <button type="button" onClick={() => go('company')}>
            全部审计 →
          </button>
        </header>
        <div className="card-scroll">
          {runtime ? (
            <>
              <p>
                {runtime.error ||
                  (runtime.value
                    ? `执行中 ${runtime.value.channels.reduce((n, c) => n + c.running, 0)} · 排队 ${runtime.value.channels.reduce((n, c) => n + c.queued, 0)} · 最近快照 ${new Date(runtime.value.checkedAt).toLocaleTimeString('zh-CN')}`
                    : '等待运行快照')}
              </p>
              {runtime.log.map((c) => (
                <p key={c.key}>
                  <time>{new Date(c.at).toLocaleTimeString('zh-CN')}</time>
                  <span>{c.text}</span>
                </p>
              ))}
            </>
          ) : (
            activity.map(([time, who, what, tone], i) => (
              <p key={i}>
                <time>{time}</time>
                <b>{who}</b>
                <span className={tone === 'bad' ? 'tone-bad-text' : undefined}>{what}</span>
              </p>
            ))
          )}
        </div>
      </article>
      {cards.slice(4).map((c) => (
        <StatCard key={c.label} c={c} go={go} />
      ))}
    </section>
  );
}

/** 用量与运行：读数、每日请求、用在了哪里、运行质量和额度。 */
function Usage() {
  return (
    <section className="cards usage glass" aria-label="用量与运行">
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
  tenant,
  onBackgroundSource,
  knowledge,
  place,
  picked,
  pick,
  filter,
  setFilter,
  gate,
  setGate,
}: {
  tenant?: string | null;
  onBackgroundSource?: () => void;
  knowledge: Knowledge;
  place: Place;
  picked: string;
  pick: (id: string) => void;
  filter: number;
  setFilter: (i: number) => void;
  gate: number | null;
  setGate: (gate: number | null) => void;
}) {
  const workTabs = place === 'knowledge' ? knowledge.tabs.filter((t, i) => i === 0 || /^(需要留意|需处理)\s/.test(t.label)).map(t => ({
    ...t, label: t.label.replace('需要留意', '需处理'),
  })) : tabs[place];
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  useEffect(() => setCollapsedGroups(new Set()), [tenant, place, filter]);
  const groupName = (x: Item) => place !== 'knowledge' ? x.group
    : x.id.startsWith('company-background:') ? '企业背景'
    : !knowledge.ids.has(x.id) ? '待处理来源'
    : ['业务数据知识', '资料知识', '会话知识'][knowledge.data?.sourceKind[x.id] ?? -1] || '其他知识';
  const [source, setSource] = useState<Item | null>(null),
    [actionError, setActionError] = useState('');
  const selection = useRef(picked);
  selection.current = picked;
  useEffect(() => {
    setSource(null);
    setActionError('');
  }, [picked, knowledge.data]);
  const info = places[place],
    side = place === 'knowledge' ? knowledge.stats : stats[place],
    more = place === 'knowledge' ? knowledge.aside : aside[place],
    tab = workTabs[filter] || workTabs[0] || { label: '全部', items: [] as Item[] },
    all = workTabs.flatMap((x) => x.items);
  const shown = tab.items.filter(
    (x) => gate === null || (GATE_OF[x.id] === gate && x.tone !== 'ok' && x.tone !== 'run'),
  );
  const current =
    source ||
    (place === 'knowledge'
      ? shown.find((x) => x.id === picked) || shown[0]
      : all.find((x) => x.id === picked) || shown[0] || tab.items[0]) ||
    knowledge.empty;
  const groupMap = new Map<string, Item[]>();
  for (const x of shown) {
    const name = groupName(x);
    const list = groupMap.get(name);
    if (list) list.push(x);
    else groupMap.set(name, [x]);
  }
  const groups = [...groupMap];
  const list = useRef<HTMLDivElement>(null);
  const visibleItems = groups.flatMap(([name, items]) => (collapsedGroups.has(name) ? [] : items));
  const shownRows = useProgressive(
    list,
    [place, filter, gate, ...collapsedGroups].join('|'),
    visibleItems.length,
    visibleItems.findIndex((x) => x.id === current?.id),
  );
  useEffect(() => {
    revealInList(list.current, list.current?.querySelector('[aria-pressed="true"]'));
  }, [current?.id]);
  // ↑↓ 在清单里换行，不离开键盘。
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const visible = shown.filter(x => !collapsedGroups.has(groupName(x)));
    const i = visible.findIndex((x) => x.id === current.id);
    const next = visible[Math.max(0, Math.min(visible.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    pick(next.id);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true }));
  };
  const flow = place === 'data' ? steps[current.id] : undefined;
  const links = place === 'knowledge' ? knowledge.related(current.id) : [];
  async function act(label: string) {
    setActionError('');
    try {
      if (label === '返回知识') setSource(null);
      else if (label === '查看来源') {
        const id = picked;
        const result = await api<Item>('/scene-knowledge/' + encodeURIComponent(current.id) + '/source');
        if (selection.current === id) setSource(result);
      } else if (label === '重新核验') await knowledge.sync(true);
    } catch (e) {
      setSource(null);
      setActionError((e as Error).message);
    }
  }
  return (
    <section className={`cards work glass${place === 'knowledge' ? ' knowledge' : ''}`} aria-label={info.name}>
      <article className="card list">
        <div className="tabs" role="tablist" aria-label={`${info.name}栏目`}>
          {workTabs.map((f, i) => (
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
          {place === 'knowledge' && knowledge.backgroundError != null && <p role="status">企业背景暂不可用，未计入知识数量。<button onClick={knowledge.refreshBackground}>重试背景读取</button></p>}
          {place === 'knowledge' && <KnowledgeSync knowledge={knowledge} />}
          {groups.length === 0 && <p className="none">这一栏里没有符合条件的记录。</p>}
          {groups.map(([name, items], index) => {
            const background = place === 'knowledge' && name === '企业背景';
            const collapsed = collapsedGroups.has(name);
            // 分段渲染：这一段的行数用完后，后面的组等滚到底部再画。
            const before = groups
              .slice(0, index)
              .reduce((n, [g, list]) => n + (collapsedGroups.has(g) ? 0 : list.length), 0);
            if (index > 0 && before >= shownRows && shownRows < visibleItems.length) return null;
            const rows = items.slice(0, Math.max(0, shownRows - before));
            return <div key={name} className={background ? 'knowledge-background-overview' : 'knowledge-group'}>
              {place === 'knowledge' ? !background && (
                <button type="button" className="asset-source-toggle" aria-expanded={!collapsed}
                  aria-label={`${name} ${items.length}`} onClick={() => setCollapsedGroups(old => {
                    const next = new Set(old);
                    if (next.has(name)) next.delete(name); else next.add(name);
                    return next;
                  })}>
                  <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
                  <span className="source-overview-title"><strong>{name}</strong><small>{collapsed ? '点击展开' : '点击收起'}</small></span>
                  <span className="num">{items.length}</span>
                </button>
              ) : <h3>{name} <span>{items.length}</span></h3>}
              {!collapsed && rows.map((x) => (
                <KnowledgeListRow key={x.id} name={x.name} summary={x.why}
                  side={place === 'knowledge' ? undefined : x.side}
                  tone={x.tone} selected={x.id === current.id} onSelect={() => pick(x.id)} />
              ))}
            </div>;
          })}
          {shownRows < visibleItems.length && (
            <p className="none">还有 {visibleItems.length - shownRows} 条，继续向下滚动加载</p>
          )}
        </div>
      </article>

      {place === 'knowledge' && tenant && current.id === `company-background:${tenant}` ? (
        <article className="card detail background-detail">
          <div className="card-scroll">
            <BackgroundKnowledge tenant={tenant} onSource={onBackgroundSource} onRefresh={knowledge.refreshBackground} />
          </div>
        </article>
      ) : (
        <article className="card detail" aria-live="polite">
          <header>
            <h2>{current.name}</h2>
            <span>
              {current.group}
              {current.side && ` · ${current.side}`}
            </span>
          </header>
          <div className="card-scroll">
            <p className={`verdict ${toneClass(current.tone)}`}>
              {actionError ||
                (place === 'knowledge' &&
                  (knowledge.error || (knowledge.busy ? '正在同步知识与关联…' : ''))) ||
                current.verdict}
            </p>
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
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setFilter(0);
                      pick(r.id);
                    }}
                  >
                    <b>{r.name}</b>
                    <span>{r.why}</span>
                  </button>
                ))}
                {links.length === 0 && (
                  <p>
                    {knowledge.data?.needsGraph
                      ? '关联待模型分析确认，星图暂以独立节点呈现。'
                      : '这条知识目前没有已验证关联。'}
                  </p>
                )}
              </div>
            )}
          </div>
          {current.actions.length > 0 && (
            <footer>
              {current.actions.map((a, i) => (
                <button
                  key={a}
                  type="button"
                  disabled={place === 'knowledge' && knowledge.busy}
                  onClick={place === 'knowledge' ? () => void act(a) : undefined}
                  className={i === 0 ? 'primary' : undefined}
                >
                  {a}
                </button>
              ))}
            </footer>
          )}
        </article>
      )}

      <div className="side">
        <article className="card facts">
          <header>
            <h2>{side.title}</h2>
          </header>
          {side.rows.map(([label, value, note], i) =>
            place === 'data' && note ? (
              <button
                key={`${label}-${i}`}
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
              <div key={`${label}-${i}`} className="fact">
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
          {more.rows.map(([label, value, tone], i) => (
            <div key={`${label}-${i}`} className="fact line">
              <span>{label}</span>
              <small className={tone ? `tone-${tone}-text` : undefined}>{value}</small>
            </div>
          ))}
        </article>
      </div>
    </section>
  );
}

function Palette({
  knowledge,
  go,
  close,
  foundation,
}: {
  go: (p: Place, id?: string) => void;
  close: () => void;
  foundation: Foundation;
  knowledge: Knowledge;
}) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const all = useMemo(
    () => [
      ...(Object.keys(places) as Place[]).filter(p => p !== 'output').map((p) => ({
        place: p,
        id: undefined as string | undefined,
        label: places[p].name,
        sub: '前往',
      })),
      ...(Object.keys(places) as Place[]).filter(p => p !== 'output').flatMap((p) =>
        (p === 'data'
          ? (foundation.data?.items || []).map(asItem)
          : p === 'knowledge'
            ? knowledge.data?.items || []
            : sceneTenant()
              ? []
              : places[p].items
        ).map((x) => ({
          place: p,
          id: x.id as string | undefined,
          label: x.name,
          sub: `${places[p].name} · ${x.why}`,
        })),
      ),
    ],
    [foundation.data, knowledge.data],
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
