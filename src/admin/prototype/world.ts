import type { EngineScene, SceneExtension, V3 } from '../../operations/engine-stage/scene';
import { FORCED, LINKED } from './label-layout';
import type { Item } from './data';

/**
 * 原型：数据基座和知识库在引擎模型里的实体。
 * - 数据基座 = 引擎输入的上游，画的是治理过程：三个数据来源（外部数据集、内部资料库、外网数据集）是三片庞大而暗淡的
 *   光尘，汇成一股向右流，连续穿过三道由大到小的处理星门（解析、口径标注、检查）。进入第一道门即“接入”，
 *   进入梦核即“AI 可用”，这两步不单独设门。每过一道门，粒子更少、更亮、更收拢；最后一道门就立在引擎三条输入光流
 *   的起点上，引擎首页也能看到它。这个视角下相机拉得很远，梦核只占画面右端很小一块，用来对比数据来源的庞大。
 * - 知识库 = 梦核内部的星链。节点是知识，连线是知识之间真实存在的关联，一条不多画。
 * 切换板块只是同一台相机移到模型的另一处。
 */
export type View = 'data' | 'knowledge' | null;
export interface WorldLabel {
  key: string;
  text: string;
  sub?: string;
  p: V3;
  kind: 'stage' | 'gate' | 'source' | 'link' | 'name' | 'node';
  on?: boolean;
  dim?: boolean;
  /** 知识节点：排位优先级（越大越先摆）；hidden 表示这次悬停与它无关，先收起。 */
  rank?: number;
  hidden?: boolean;
}

const CHAMPAGNE: V3 = [1, 0.84, 0.6],
  FROST: V3 = [0.84, 0.9, 1],
  GOLD: V3 = [1, 0.74, 0.4],
  SILVER: V3 = [0.78, 0.77, 0.74];
/** 节点下方的小标题：去掉引号，取前 10 个字。 */
const brief = (name: string) => {
  const t = name.replace(/[“”《》]/g, '');
  return t.length > 10 ? t.slice(0, 10) + '…' : t;
};
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const mixv = (a: V3, b: V3, k: number): V3 => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const rotY = (p: V3, a: number): V3 => [
  p[0] * Math.cos(a) + p[2] * Math.sin(a),
  p[1],
  -p[0] * Math.sin(a) + p[2] * Math.cos(a),
];
const rotX = (p: V3, a: number): V3 => [
  p[0],
  p[1] * Math.cos(a) - p[2] * Math.sin(a),
  p[1] * Math.sin(a) + p[2] * Math.cos(a),
];
const smooth = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));

/* ---------- 数据基座：三个来源 → 三道处理星门 → 引擎的三条输入光流 ---------- */
/** 治理的五步。接入和 AI 可用不设门：第 1–3 步各有一道星门。 */
export const GATES = ['接入', '解析', '口径标注', '检查', 'AI 可用'];
/** 每条记录停在哪道门前（5 = 已可用）。 */
export const GATE_OF: Record<string, number> = {
  d1: 2,
  d2: 3,
  d3: 3,
  d4: 4,
  d5: 1,
  d6: 2,
  d7: 4,
  d8: 4,
  d9: 5,
  d10: 5,
};
/** 三个来源：位置、光尘半径、占全部粒子的比例、规模说明。数量为合成数据。 */
const SOURCES: { name: string; sub: string; c: V3; r: number; share: number }[] = [
  {
    name: '外部数据集',
    sub: '3 个业务系统 · 38 个数据集 · 约 128 万行',
    c: [-22.5, -3.5, -0.8],
    r: 3.2,
    share: 0.5,
  },
  { name: '内部资料库', sub: '5 个空间 · 23 份资料 · 32 个版本', c: [-23.6, 0.1, 1.2], r: 2.3, share: 0.22 },
  { name: '外网数据集', sub: '3 个资讯来源 · 今日 1,240 条', c: [-22.5, 2.9, -1.5], r: 2.6, share: 0.28 },
];
/** 三道处理星门（解析、口径标注、检查）：位置和半径，由大到小。最后一道门立在引擎三条输入光流的起点上。 */
const GX = [-16.5, -11, -5.6],
  GR = [4.3, 2.5, 1.25],
  CY = 0.15;
/** 一个粒子能走到第几道门：越往后越少，体现连续筛选。 */
const SURVIVE = [1, 0.42, 0.16];
/** 引擎三条输入光流的起点：在原位置上向中间收拢，好让最后一道门可以更小（见 World.inputStart）。 */
const tighten = (far: V3): V3 => [far[0], CY + (far[1] - CY) * 0.68, -0.2 + (far[2] + 0.2) * 0.68];
const IN_FAR: V3[] = (
  [
    [-5.6, -1.15, -0.8],
    [-5.6, 0.15, 0.4],
    [-5.6, 1.45, -0.3],
  ] as V3[]
).map(tighten);
const bz = (a: V3, b: V3, c: V3, d: V3, u: number): V3 => {
  const m = 1 - u;
  return [0, 1, 2].map(
    (i) => m * m * m * a[i] + 3 * m * m * u * b[i] + 3 * m * u * u * c[i] + u * u * u * d[i],
  ) as V3;
};
/** 引擎自己的第 i 条输入光流（与 scene.ts laneDef 一致）：从最后一道门一路收进梦核。 */
const ownLane = (i: number): [V3, V3, V3, V3] => {
  const far = IN_FAR[i],
    dir: V3 = [-1, (i - 1) * 0.225, far[2] * 0.15],
    l = Math.hypot(...dir),
    end = mul(dir, 1.06 / l);
  return [far, [far[0] + 2.4, far[1], far[2]], add(end, mul(dir, 1.5 / l)), end];
};
const lane = (i: number, u: number): V3 => bz(...ownLane(i), u);
/** 三条星链：从来源标签处出发，按每道门的大小等比例穿过三道门，接到引擎三条输入光流的起点。 */
const XL = -21.2,
  XT = -25.6;
const ANCHORS: V3[][] = IN_FAR.map((far, i) => {
  const src = SOURCES[i],
    at = (k: number): V3 => [GX[k], CY + ((far[1] - CY) * GR[k]) / GR[2], (far[2] * GR[k]) / GR[2]],
    head: V3 = [XL, src.c[1] * 0.92, src.c[2] * 0.6],
    next = bz(...ownLane(i), 0.16);
  return [[XT, head[1], head[2]], head, at(0), at(1), far, next];
});
/** 第 i 条星链在 x 处的位置；t 给出时带一点缓慢的起伏，越靠近最后一道门越平稳。 */
const linkAt = (i: number, x: number, t?: number): V3 => {
  const a = ANCHORS[i];
  let k = 0;
  while (k < 3 && x > a[k + 2][0]) k++;
  const p0 = a[k],
    p1 = a[k + 1],
    p2 = a[k + 2],
    p3 = a[Math.min(k + 3, 5)],
    w = clamp01((x - p1[0]) / (p2[0] - p1[0])),
    cr = (j: 1 | 2) =>
      0.5 *
      (2 * p1[j] +
        (p2[j] - p0[j]) * w +
        (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * w * w +
        (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * w * w * w),
    amp = t === undefined ? 0 : 0.16 * clamp01((GX[2] - x) / 7);
  return [
    x,
    cr(1) + (amp && Math.sin(x * 0.55 + t! * 0.5 + i * 2.1) * amp),
    cr(2) + (amp && Math.cos(x * 0.4 + t! * 0.37 + i * 1.3) * amp),
  ];
};
/** 五步各自在流向上的位置和光流半径：接入口、三道门、梦核。 */
const SX = [GX[0] - 3.4, GX[0], GX[1], GX[2], -1.06],
  SR = [GR[0] * 1.1, GR[0], GR[1], GR[2], 0.3];
type Mote = {
  src: number;
  ox: number;
  oy: number;
  oz: number;
  a: number;
  r: number;
  u: number;
  v: number;
  end: number;
  tw: number;
};

/* ---------- 知识库：梦核内部的星链 ---------- */
const INNER_R = 0.8;
/** 节点不多时逐对计算斥力；超过这个数改按近邻计算（斥力随距离三次方衰减，远处可忽略），计算量从平方降到线性。 */
const EXACT_REPULSION = 240;
const REPULSION_CUTOFF = 0.32;
function repel(p: V3[], f: V3[], strength: number) {
  const push = (i: number, j: number) => {
    const a = p[i],
      b = p[j],
      dx = a[0] - b[0],
      dy = a[1] - b[1],
      dz = a[2] - b[2],
      l = Math.max(0.05, Math.sqrt(dx * dx + dy * dy + dz * dz)),
      k = strength / (l * l * l),
      fi = f[i],
      fj = f[j];
    fi[0] += dx * k;
    fi[1] += dy * k;
    fi[2] += dz * k;
    fj[0] -= dx * k;
    fj[1] -= dy * k;
    fj[2] -= dz * k;
  };
  if (p.length <= EXACT_REPULSION) {
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) push(i, j);
    return;
  }
  const cells = p.map((q) => q.map((v) => Math.floor(v / REPULSION_CUTOFF) + 64));
  const key = (x: number, y: number, z: number) => (x * 128 + y) * 128 + z;
  const grid = new Map<number, number[]>();
  cells.forEach(([x, y, z], i) => {
    const list = grid.get(key(x, y, z));
    if (list) list.push(i);
    else grid.set(key(x, y, z), [i]);
  });
  cells.forEach(([x, y, z], i) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(key(x + dx, y + dy, z + dz));
          if (list) for (const j of list) if (j > i) push(i, j);
        }
  });
}
const SPACE_NAMES = ['销售与客户', '财务与经营分析', '产品与研发', '人事与行政', '公司公共资料'];
const REGIONS: V3[] = [
  [-0.7, 0.45, 0.4],
  [0.7, 0.5, 0.3],
  [0.15, -0.75, 0.5],
  [-0.45, -0.3, -0.75],
  [0.6, 0.0, -0.75],
];

export class World implements SceneExtension {
  overview = false;
  onNavigate: (place: 'home' | 'knowledge') => void = () => {};
  view: View = null;
  selected = '';
  gate: number | null = null;
  hover = '';
  hoverGate = -1;
  onPick: (id: string) => void = () => {};
  onGate: (gate: number | null) => void = () => {};
  private scene: EngineScene | null = null;
  private motes: Mote[] = [];
  private runners: { id: string; gate: number; seed: number; at: V3 }[] = [];
  private doneAt: V3 | null = null;
  private nodes: { id: string; o: V3; kind: number; at: V3 }[] = [];
  private links: [number, number][] = [];
  private degree: number[] = [];
  private grow: number[] = [];
  private near = new Set<number>();
  private kData = 0;
  private kKnow = 0;
  private mx = 0;
  private spin = 0;

  constructor(
    private data: Item[],
    private knowledge: Item[],
    relations: [string, string, string][],
    sourceKind: Record<string, number>,
  ) {
    this.buildFlow();
    this.buildStars(relations, sourceKind);
  }
  private knowledgeRevision = '';
  setKnowledge(items: Item[], relations: [string, string, string][], sourceKind: Record<string, number>) {
    const revision = JSON.stringify([items, relations, sourceKind]);
    if (revision === this.knowledgeRevision) return;
    this.knowledgeRevision = revision;
    this.knowledge = items;
    this.grow = [];
    this.near.clear();
    this.hover = '';
    this.buildStars(relations, sourceKind);
  }
  private stageCounts = ['—', '—', '—', '—', '—'];
  private sourceNotes = ['尚未读取', '尚未读取', '尚未接入'];
  private gates: Record<string, number> = {};
  private origins: Record<string, number> = {};
  setFoundation(
    items: (Item & { gate: number; sourceKind: number })[],
    stageCounts: number[] | null,
    sources: { count: number }[],
  ) {
    this.data = items;
    this.stageCounts = stageCounts ? stageCounts.map(String) : ['—', '—', '—', '—', '—'];
    this.sourceNotes = [0, 1, 2].map((i) =>
      i === 2 ? '尚未接入' : sources[i] ? `${sources[i].count} 项资产` : '尚未读取',
    );
    this.gates = Object.fromEntries(items.map((x) => [x.id, x.gate]));
    this.origins = Object.fromEntries(items.map((x) => [x.id, x.sourceKind]));
    this.runners = items
      .filter((x) => x.tone === 'run')
      .map((x, i) => ({
        id: x.id,
        gate: Math.max(1, Math.min(4, x.gate)),
        seed: ((i + 1) * 0.137) % 1,
        at: [0, 0, 0],
      }));
  }
  private buildFlow() {
    const r = seeded(5),
      g = () => (r() + r() + r() - 1.5) * 0.9;
    SOURCES.forEach((s, si) => {
      const n = Math.round(700 * s.share);
      for (let i = 0; i < n; i++) {
        // 这个粒子在第几道门被筛掉（2 = 走到最后一道门，交给引擎的输入光流）。
        const pick = r();
        let end = 0;
        while (end < 2 && pick < SURVIVE[end + 1]) end++;
        this.motes.push({
          src: si,
          ox: g() * s.r,
          oy: g() * s.r,
          oz: g() * s.r * 0.7,
          a: r() * 6.2832,
          r: Math.sqrt(r()),
          u: r(),
          v: 0.8 + r() * 0.4,
          end,
          tw: r(),
        });
      }
    });
    this.data
      .filter((d) => d.tone === 'run')
      .forEach((d) => this.runners.push({ id: d.id, gate: GATE_OF[d.id], seed: r(), at: [0, 0, 0] }));
    this.runners.push({ id: '', gate: 2, seed: r(), at: [0, 0, 0] });
  }
  /** 一个粒子在进度 u（0 = 来源，1 = 最后一道门）处的位置，以及走在第几段（-1 = 还没进第一道门）。 */
  private place(m: Mote, u: number, t: number): { p: V3; stage: number } {
    const src = SOURCES[m.src];
    // 0–0.3 从来源汇向第一道门；0.3–1 依次穿过三道门。
    if (u < 0.3) {
      const k = smooth(u / 0.3),
        ring: V3 = [GX[0], CY + Math.sin(m.a) * m.r * GR[0] * 0.86, Math.cos(m.a) * m.r * GR[0] * 0.86],
        cloud = add(src.c, [m.ox, m.oy + Math.sin(t * 0.2 + m.tw * 20) * 0.15, m.oz]);
      return { p: mixv(cloud, ring, k), stage: -1 };
    }
    const f = Math.min(1.9999, ((u - 0.3) / 0.7) * 2),
      k = Math.floor(f),
      w = smooth(f - k),
      x = GX[k] + (GX[k + 1] - GX[k]) * w,
      rad = (GR[k] + (GR[k + 1] - GR[k]) * w) * 0.86;
    let y = CY + Math.sin(m.a + t * 0.05) * m.r * rad,
      z = Math.cos(m.a + t * 0.05) * m.r * rad;
    // 一路上渐渐并入自己来源的那条链路：进第一道门时还铺满整个门，到最后一道门时全部落在链路上。
    const to = linkAt(m.src, x, t),
      g = Math.pow((x - GX[0]) / (GX[2] - GX[0]), 1.4);
    y += (to[1] - y) * g;
    z += (to[2] - z) * g;
    return { p: [x, y, z], stage: k };
  }
  /** 星链的位置由关联本身决定：有关联的知识互相靠近，没有关联的互相推开，同一空间的略微聚拢。 */
  private buildStars(relations: [string, string, string][], sourceKind: Record<string, number>) {
    const r = seeded(11),
      index = new Map(this.knowledge.map((x, i) => [x.id, i]));
    const region = (x: Item) =>
      Math.max(0, SPACE_NAMES.indexOf(SPACE_NAMES.includes(x.side) ? x.side : x.group));
    const home = this.knowledge.map((x) => mul(REGIONS[region(x) % REGIONS.length], 0.5));
    const p = home.map((h) => add(h, [(r() - 0.5) * 0.3, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3]));
    this.links = relations
      .map(([a, b]) => [index.get(a)!, index.get(b)!] as [number, number])
      .filter(([a, b]) => a !== undefined && b !== undefined);
    for (let step = 0; step < 320; step++) {
      const f = p.map(() => [0, 0, 0] as V3);
      repel(p, f, 0.0045);
      this.links.forEach(([i, j]) => {
        const d: V3 = [p[j][0] - p[i][0], p[j][1] - p[i][1], p[j][2] - p[i][2]],
          l = Math.hypot(...d) || 1,
          k = (0.5 * (l - 0.3)) / l;
        f[i] = add(f[i], mul(d, k));
        f[j] = add(f[j], mul(d, -k));
      });
      p.forEach((q, i) => {
        const pull: V3 = [home[i][0] - q[0], home[i][1] - q[1], home[i][2] - q[2]];
        let n = add(q, mul(add(f[i], mul(pull, 0.06)), 0.12));
        const l = Math.hypot(...n);
        if (l > INNER_R) n = mul(n, INNER_R / l);
        p[i] = n;
      });
    }
    this.nodes = this.knowledge.map((x, i) => ({ id: x.id, o: p[i], kind: sourceKind[x.id] ?? 1, at: p[i] }));
    this.degree = this.nodes.map(() => 0);
    this.links.forEach(([a, b]) => {
      this.degree[a]++;
      if (b !== a) this.degree[b]++;
    });
  }
  attach(scene: EngineScene | null) {
    this.scene?.setExtension(null);
    this.scene = scene;
    scene?.setExtension(this);
  }
  /** 看知识库时引擎自己的一切都隐去；看数据基座时引擎保持原样，只是远远地缩在右端。 */
  engineAlpha() {
    return 1 - this.kKnow;
  }
  /** 镜头基本推进到位：知识标注可以开始淡入（它们每帧跟着光点走，镜头最后的微调不会错位）。 */
  knowledgeSettled() {
    return this.kKnow > 0.9;
  }
  /** 引擎的三条输入光流从最后一道门里出发。 */
  inputStart(_index: number, far: V3) {
    return tighten(far);
  }
  /** 看知识库时不显示梦核表面的迸发和火花。 */
  calm() {
    return this.view === 'knowledge';
  }

  camera(aspect: number) {
    const fit = (halfWidth: number, min: number) =>
      Math.max(min, halfWidth / (0.344 * Math.max(aspect, 0.8)));
    if (this.view === 'data') {
      // 相机拉得很远：三片来源占满左侧，梦核在最右端只剩一小点，对比出数据来源的庞大。
      const c: V3 = [-11.6, 0.1, 0],
        d = Math.min(46, fit(16.4, 23));
      // 从左前方斜着看：三道门才能看成一个套一个、由大到小的圆环。
      return { e: add(c, [-d * 0.36 + this.mx * 1.5, d * 0.1, d * 0.93]), c };
    }
    if (this.view === 'knowledge') {
      // 镜头推进梦核，看里面的星链。
      const d = Math.min(3.4, fit(1.05, 2.5));
      return { e: [0.25 + this.mx * 0.7, 0.2, d] as V3, c: [0, 0, 0] as V3 };
    }
    return null;
  }

  draw({ pt, ln, t, dt, reduced }: Parameters<SceneExtension['draw']>[0]) {
    const ease = (v: number, to: number) => (reduced ? to : v + (to - v) * Math.min(1, dt * 5));
    this.kData = ease(this.kData, this.view === 'data' ? 1 : 0);
    this.kKnow = ease(this.kKnow, this.view === 'knowledge' ? 1 : 0);
    // 不在本视角时只留很淡的一层，提示它们一直在模型里，又不改动引擎首页原本的样子；
    // 看知识星链时数据基座的星尘、星门整片隐去，不和星链抢画面。
    const A = 0.14 * (1 - this.kKnow) + 0.86 * this.kData,
      B = 0.1 + 0.9 * this.kKnow;
    const ring = (at: V3, rad: number, alpha: number) => {
      for (let i = 0; i < 28; i++) {
        const a0 = (i / 28) * 6.2832,
          a1 = ((i + 1) / 28) * 6.2832;
        ln(
          add(at, [Math.cos(a0) * rad, Math.sin(a0) * rad, 0]),
          add(at, [Math.cos(a1) * rad, Math.sin(a1) * rad, 0]),
          [1, 0.95, 0.85],
          alpha,
        );
      }
    };
    const lit = (k: number) => (this.gate === null || this.gate === k ? 1 : 0.2);
    // 选中一条卡住的记录时，它卡在的那道门亮起来（不再单独摆出光珠）。
    const held = this.data.find((d) => d.id === this.selected && d.tone !== 'ok' && d.tone !== 'run'),
      heldAt = held ? this.gates[held.id] : -1;

    /* ----- 三道处理星门：由大到小 ----- */
    const rim = (x: number, rad: number, b: number): V3 => [x, CY + Math.cos(b) * rad, Math.sin(b) * rad];
    GX.forEach((x, k) => {
      const step = k + 1,
        on = this.gate === step || heldAt === step,
        hov = this.hoverGate === k,
        rad = GR[k],
        dir = k % 2 ? -1 : 1,
        depth = 0.05 + rad * 0.035,
        // 整道门绕自己的轴缓慢自转，相邻两道方向相反、快慢不一。
        spin = reduced ? 0 : t * (0.07 + k * 0.025) * dir,
        around = (xx: number, r: number, b: number) => rim(xx, r, b + spin),
        drop = 0.4 + rad * 0.1,
        // 最后一道门立在引擎输入光流的起点上，引擎首页也看得到；看知识库时全部隐去。
        base = (k === 2 ? 0.5 + 0.5 * this.kData : A) * (1 - this.kKnow),
        a = (on ? 1 : hov ? 0.8 : 0.55) * base * (this.gate === null || on ? 1 : 0.35),
        SEG = 96;
      for (let i = 0; i < SEG; i++) {
        const a0 = (i / SEG) * 6.2832,
          a1 = ((i + 1) / SEG) * 6.2832;
        // 门框：前后两道主环；外侧一圈刻度环；内侧一圈缓慢转动的虚线环和一层很淡的光阑。
        ln(around(x - depth, rad, a0), around(x - depth, rad, a1), CHAMPAGNE, a);
        ln(around(x + depth, rad, a0), around(x + depth, rad, a1), CHAMPAGNE, a * 0.7);
        ln(around(x, rad * 1.08, a0), around(x, rad * 1.08, a1), CHAMPAGNE, a * 0.28);
        if (i % 3 === 0) {
          const s = t * (0.1 + k * 0.03) * dir;
          ln(around(x, rad * 0.9, a0 + s), around(x, rad * 0.9, a1 + s), CHAMPAGNE, a * 0.45);
        }
        if (i % 2 === 0) ln(around(x, rad * 0.62, a0), around(x, rad * 0.62, a1), FROST, a * 0.1);
      }
      // 前后两道主环之间的肋；外环上的刻度，每 30° 一道长刻度。
      for (let i = 0; i < 24; i++) {
        const b = (i / 24) * 6.2832;
        ln(around(x - depth, rad, b), around(x + depth, rad, b), CHAMPAGNE, a * 0.55);
      }
      for (let i = 0; i < 72; i++) {
        const b = (i / 72) * 6.2832,
          long = i % 6 === 0;
        ln(
          around(x, rad * 1.08, b),
          around(x, rad * (long ? 1.15 : 1.105), b),
          CHAMPAGNE,
          a * (long ? 0.6 : 0.26),
        );
      }
      // 外环上一段带拖尾的扫描弧，和内圈反向转动。
      const sweep = -t * 0.22 * dir;
      for (let i = 0; i < 16; i++)
        ln(
          around(x, rad * 1.08, sweep + i * 0.055),
          around(x, rad * 1.08, sweep + (i + 1) * 0.055),
          [1, 0.96, 0.88],
          a * (i / 16),
        );
      pt(around(x, rad * 1.08, sweep + 16 * 0.055), [1, 0.96, 0.88], a, 0.06);
      // 门下方的一道细指引线，标题挂在线的下端。
      ln(rim(x, rad * 1.28, Math.PI), rim(x, rad * 1.28 + drop, Math.PI), [1, 0.95, 0.85], a * 0.6);
      pt(rim(x, rad * 1.28 + drop, Math.PI), [1, 0.95, 0.85], a * 0.8, 0.045);
      // 四个锚点：斜向各一颗星和一道向外的短桩。
      for (let q = 0; q < 4; q++) {
        const b = 0.7854 + q * 1.5708;
        pt(around(x, rad * 1.08, b), FROST, a * 0.9, 0.07);
        ln(around(x, rad * 1.15, b), around(x, rad * 1.24, b), CHAMPAGNE, a * 0.7);
      }
    });

    /* ----- 光尘：三个来源汇流，逐门筛选 ----- */
    this.motes.forEach((m) => {
      // 被筛掉的粒子只走到它的终点那道门，然后回到来源重新出发。
      const limit = 0.3 + (m.end / 2) * 0.7,
        u = ((reduced ? m.u : m.u + t * 0.02 * m.v) % 1) * limit,
        { p, stage } = this.place(m, u, t);
      const passed = stage < 0 ? 0 : clamp01((stage + 1 + (u - 0.3 - stage * 0.35) / 0.35) / 3),
        fadeIn = clamp01(u * 40),
        fadeOut = clamp01((limit - u) * 30);
      // 由暗到亮：来源处很暗，每过一道门亮一级。颗粒小而实，不做大片柔光。
      const alpha = (0.55 + 0.4 * passed * passed) * fadeIn * fadeOut,
        color = mixv(SILVER, m.src === 0 ? CHAMPAGNE : FROST, clamp01(passed * 1.3));
      pt(p, color, alpha * A * lit(stage + 2), 0.062 + 0.03 * passed);
    });
    // 三条星链始终可见：从来源标签处出发，随门的大小收拢着穿过三道门；标签以外向左渐隐。
    // 过最后一道门后交给引擎自己的三条输入光流（它在起点处由暗渐亮，这里相应地渐隐，两段接成一条）。
    IN_FAR.forEach((far, i) => {
      const N = 96,
        LA = 0.24 * A * (1 - this.kKnow),
        at = (j: number) => linkAt(i, XT + ((far[0] - XT) * j) / N, reduced ? undefined : t);
      let prev = at(0);
      for (let j = 1; j <= N; j++) {
        const q = at(j);
        ln(prev, q, FROST, LA * clamp01((q[0] - XT) / (XL - 1.2 - XT)));
        prev = q;
      }
      for (let j = 0; j < 10; j++) ln(lane(i, j / 60), lane(i, (j + 1) / 60), FROST, LA * (1 - (j + 1) / 10));
    });
    // 正在处理的记录：光流里更亮的一颗，正从上一步走向下一步。
    this.runners.forEach((q) => {
      const k = Math.max(1, Math.min(4, q.gate)),
        w = reduced ? 0.5 : (q.seed + t * 0.05) % 1,
        x = SX[k - 1] + (SX[k] - SX[k - 1]) * w,
        rad = SR[k - 1] + (SR[k] - SR[k - 1]) * w;
      q.at = [x, CY + Math.sin(q.seed * 30) * rad * 0.5, Math.cos(q.seed * 30) * rad * 0.3];
      const on = !!q.id && q.id === this.selected;
      pt(q.at, FROST, A * lit(k), on ? 0.26 : 0.14);
      if (on) ring(q.at, 0.36 + 0.04 * Math.sin(t * 2.2), 0.85 * A);
    });
    // 选中的是已可用的记录：在它那条输入光流上标出它。
    const done = this.data.find((d) => d.id === this.selected && d.tone === 'ok');
    this.doneAt = null;
    if (done && this.view === 'data') {
      const w = reduced ? 0.5 : (t * 0.06) % 1;
      this.doneAt = lane(this.origins[done.id] ?? 0, w);
      pt(this.doneAt, CHAMPAGNE, A, 0.2);
      ring(this.doneAt, 0.36 + 0.04 * Math.sin(t * 2.2), 0.85 * A);
    }

    /* ----- 梦核内部的知识星链 ----- */
    // 只画真实存在的关联。发光收敛：节点小而实，被关联得多的节点更大。
    this.spin = t * -0.03;
    this.nodes.forEach((n) => (n.at = rotX(rotY(n.o, this.spin), 0.15)));
    const sel = this.nodes.findIndex((n) => n.id === this.selected),
      hov = this.nodes.findIndex((n) => n.id === this.hover),
      focus = hov >= 0 ? hov : sel;
    const linked = new Set<number>();
    this.links.forEach(([i, j]) => {
      const on = i === focus || j === focus;
      if (on) (linked.add(i), linked.add(j));
      ln(
        this.nodes[i].at,
        this.nodes[j].at,
        on ? [1, 0.93, 0.8] : SILVER,
        (on ? 0.55 : hov >= 0 ? 0.06 : 0.16) * B,
      );
    });
    this.near = linked;
    const kc = [CHAMPAGNE, FROST, GOLD];
    this.nodes.forEach((n, i) => {
      const on = i === sel,
        hot = i === hov;
      this.grow[i] = ease(this.grow[i] ?? 0, hot ? 1 : 0);
      const bright = on || hot || linked.has(i) || hov < 0;
      // 发光收敛：光点小一号、亮度压低，被关联得多的仍然更大；悬停和选中的再提亮，焦点依然醒目。
      const size = (0.016 + Math.min(this.degree[i], 6) * 0.006) * (1 + 0.5 * this.grow[i]) * (on ? 1.25 : 1);
      pt(n.at, kc[n.kind], (on || hot ? 0.6 : bright ? 0.32 : 0.12) * B, size);
      if (on) ring(n.at, size + 0.02 + 0.006 * Math.sin(t * 2.2), 0.6 * B);
    });
  }

  pointer(x: number, y: number, click: boolean) {
    const scene = this.scene;
    if (!scene) return undefined;
    // 概览中的梦核承载知识星链；数据视角中的同一核心是返回引擎概览的入口。
    if ((this.view === 'data' || this.overview) && scene.coreContains(x, y)) {
      if (click) this.onNavigate(this.view === 'data' ? 'home' : 'knowledge');
      return true;
    }
    if (!this.view) return undefined;
    this.mx = x / (window.innerWidth || 1) - 0.5;
    let best = '',
      bd = 18 * 18;
    const near = (p: V3, id: string) => {
      const s = scene.project(p);
      if (s.w <= 0) return;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bd) ((bd = d), (best = id));
    };
    let gate = -1;
    if (this.view === 'data') {
      this.runners.forEach((q) => q.id && near(q.at, q.id));
      if (!best)
        GX.forEach((gx, k) => {
          // 点某道星门：只看卡在这一步的记录。
          const c = scene.project([gx, CY, 0]),
            top = scene.project([gx, CY + GR[k], 0]);
          if (c.w > 0 && Math.abs(x - c.x) < 26 && Math.abs(y - c.y) < Math.abs(top.y - c.y) + 10)
            gate = k + 1;
        });
    } else this.nodes.forEach((n) => near(n.at, n.id));
    this.hover = best;
    this.hoverGate = gate - 1;
    if (click) {
      if (best) this.onPick(best);
      else if (gate >= 1) this.onGate(this.gate === gate ? null : gate);
    }
    return !!best || gate >= 1;
  }

  /** 数据基座里选中项在模型中的位置：正在处理的光珠、已可用记录所在的输入光流，或卡住它的那道星门底部。 */
  focus(): V3 | null {
    if (this.view !== 'data' || !this.selected) return null;
    const run = this.runners.find((q) => q.id === this.selected);
    if (run) return run.at;
    if (this.doneAt) return this.doneAt;
    const g = this.gates[this.selected];
    return g >= 1 && g <= 3 ? [GX[g - 1], CY - GR[g - 1], 0] : null;
  }

  /** 当前视角下要用文字标出来的位置，由外壳投影成 HTML 标签。 */
  labels(): WorldLabel[] {
    const out: WorldLabel[] = [];
    if (this.view === 'data') {
      SOURCES.forEach((s, i) =>
        out.push({
          key: 's' + i,
          kind: 'source',
          text: s.name,
          sub: this.sourceNotes[i],
          p: linkAt(i, XL),
        }),
      );
      GX.forEach((x, k) =>
        out.push({
          key: 'g' + (k + 1),
          kind: 'gate',
          text: this.stageCounts[k + 1],
          sub: GATES[k + 1],
          p: [x, CY - GR[k] * 1.38 - 0.4, 0],
          on: this.gate === k + 1,
        }),
      );
      for (const id of new Set([this.selected, this.hover])) {
        const it = this.data.find((d) => d.id === id),
          at =
            this.runners.find((q) => q.id && q.id === id)?.at || (id === this.selected ? this.doneAt : null);
        if (it && at)
          out.push({
            key: id === this.selected ? 'sel' : 'hov',
            kind: 'name',
            text: it.name,
            p: at,
            on: id === this.selected,
          });
      }
    } else if (this.view === 'knowledge') {
      const sel = this.nodes.findIndex((n) => n.id === this.selected),
        hov = this.nodes.findIndex((n) => n.id === this.hover);
      // 选中、悬停的总是显示；其次是与当前焦点相连的；再按被关联的次数（与光点大小一致）。
      // 悬停时与它无关的标注收起，不只是调淡，免得还占着位置挡字。
      this.nodes.forEach((n, i) => {
        const name = this.knowledge[i]?.name || '',
          full = i === sel || i === hov,
          linked = this.near.has(i);
        out.push({
          key: 'n' + i,
          kind: 'node',
          text: full ? name : brief(name),
          p: n.at,
          on: full,
          rank: full ? FORCED : (linked ? LINKED : 0) + (this.degree[i] ?? 0) * 10 + 1 / (i + 2),
          hidden: hov >= 0 && !full && !linked,
        });
      });
    }
    return out;
  }
}
