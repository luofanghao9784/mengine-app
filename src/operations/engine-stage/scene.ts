import { advanceSatelliteRoll, evolutionFrame, type EvolutionPhase } from './evolution-demo';
/**
 * 3D engine stage, ported from the confirmed prototype (artifact「梦核引擎仪表盘」3D version, 2026-10-06).
 * Production rules: every photon, gate mote and burst comes from a real snapshot; ambient structure
 * (lattice, dust, loop outlines) carries no counts. Reduced motion freezes time and draws no photons.
 */
import type {
  EngineTelemetry,
  TelemetryChannel,
  TelemetryChannelCode,
} from '../../../contracts/public-api/engine-telemetry';
import {
  BEADS,
  channelInfo,
  completions,
  LANE_PARTICLES,
  particles,
  type Stage,
} from '../engine-dashboard-model';

export type Focus = Stage | 'evo' | null;
export type Lens = 'r' | 'q' | 'w' | 'u' | 'd' | 'f';
export type Hit =
  | { kind: 'lane'; st: Stage; code: TelemetryChannelCode }
  | { kind: 'loop'; st: 'pr' | 'evo' }
  | { kind: 'core' };
export interface SceneDom {
  top: HTMLElement;
  labels: Partial<Record<TelemetryChannelCode, HTMLElement>>;
  caps: Partial<Record<Stage | 'evo', HTMLElement>>;
  haloWrap: HTMLElement;
  halo: HTMLElement;
  coreNum: HTMLElement;
  panel: HTMLElement;
}
export interface SceneEvents {
  evolution: (phase: EvolutionPhase) => void;
  pick: (st: Stage | 'evo', code: TelemetryChannelCode | null) => void;
  home: () => void;
  hover: (hit: Hit | null, x: number, y: number) => void;
}
type V3 = [number, number, number];
type Values = { r: number; q: number; w: number; u: number; f: number; d: number };
const ZERO: Values = { r: 0, q: 0, w: 0, u: 0, f: 0, d: 0 };
const values = (c: TelemetryChannel): Values => ({
  r: c.running,
  q: c.queued,
  w: c.waiting,
  u: c.unknown,
  f: c.failed,
  d: c.completedRecent,
});
/* ---------- math ---------- */
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const mix = (a: V3, b: V3, k: number): V3 => [
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
const bz = (p0: V3, p1: V3, p2: V3, p3: V3, u: number): V3 => {
  const m = 1 - u;
  return [0, 1, 2].map(
    (i) => m * m * m * p0[i] + 3 * m * m * u * p1[i] + 3 * m * u * u * p2[i] + u * u * u * p3[i],
  ) as V3;
};
function persp(fy: number, as: number, n: number, f: number) {
  const t = 1 / Math.tan(fy / 2),
    nf = 1 / (n - f);
  return [t / as, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0];
}
function lookAt(e: V3, c: V3, u: V3) {
  const z = norm(sub(e, c)),
    x = norm(cross(u, z)),
    y = cross(z, x);
  return [
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, e),
    -dot(y, e),
    -dot(z, e),
    1,
  ];
}
function mm(a: number[], b: number[]) {
  const o = new Array<number>(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
  return o;
}
type Spring = { x: number; v: number };
const sp = (x: number): Spring => ({ x, v: 0 });

/* ---------- geometry (deterministic so every viewer sees the same core) ---------- */
let rs = 11;
const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
function lattice(N: number, R: number, amp: number, k: number) {
  const p: V3[] = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N,
      r = Math.sqrt(1 - y * y),
      a = i * 2.39996;
    const q: V3 = [Math.cos(a) * r, y, Math.sin(a) * r];
    const bump =
      1 +
      amp * (Math.sin(q[0] * 3.1 + 1.3) * Math.cos(q[1] * 2.7) + 0.6 * Math.sin(q[2] * 4.3 + q[0] * 2)) +
      amp * 0.5 * (rnd() - 0.5);
    p.push(mul(q, R * bump));
  }
  const e = new Set<string>(),
    adj: number[][] = p.map(() => []);
  p.forEach((a, i) => {
    p.map((b, j) => ({ j, d: len(sub(a, b)) }))
      .filter((o) => o.j !== i)
      .sort((x, y) => x.d - y.d)
      .slice(0, k)
      .forEach((o) => {
        const key = i < o.j ? i + '_' + o.j : o.j + '_' + i;
        if (!e.has(key)) {
          e.add(key);
          adj[i].push(o.j);
          adj[o.j].push(i);
        }
      });
  });
  return { p, e: [...e].map((s) => s.split('_').map(Number) as [number, number]), adj };
}
const OUT = lattice(240, 1, 0.13, 3),
  INN = lattice(90, 0.48, 0.18, 3);
// Crossing Mengine orbits: work (+45°), evolution (-45°, visual simulation only).
const LOOP_R = 2.35,
  LOOP_TILT = Math.acos(7 / 16);
function mkLoop(deg: number) {
  const a = (deg * Math.PI) / 180,
    u: V3 = [Math.cos(a), Math.sin(a), 0],
    w: V3 = [-Math.sin(a), Math.cos(a), 0],
    v = add(mul(w, Math.cos(LOOP_TILT)), [0, 0, Math.sin(LOOP_TILT) * (deg > 0 ? 1 : -1)]);
  return { u, v };
}
const WORK = mkLoop(45),
  IMPROVE = mkLoop(-45);
const loopPt = (L: { u: V3; v: V3 }, a: number) =>
  add(mul(L.u, Math.cos(a) * LOOP_R), mul(L.v, Math.sin(a) * LOOP_R));
const DUST = Array.from({ length: 520 }, () => {
  const r = 4 + rnd() * 14,
    a = rnd() * 6.283,
    b = Math.acos(2 * rnd() - 1);
  return {
    p: [r * Math.sin(b) * Math.cos(a), r * Math.cos(b) * 0.6, r * Math.sin(b) * Math.sin(a) - 2] as V3,
    s: 0.015 + rnd() * 0.03,
    a: 0.08 + rnd() * 0.25,
    ph: rnd() * 6.28,
  };
});
const C_SIL: V3 = [0.78, 0.77, 0.74],
  C_CH: V3 = [1, 0.84, 0.6],
  C_IN: V3 = [0.84, 0.9, 1],
  C_OUT: V3 = [1, 0.74, 0.4],
  C_CO: V3 = [1, 0.42, 0.36];

/* ---------- shaders ---------- */
const VS_PT = `#version 300 es
in vec3 aP;in vec4 aC;in float aS;uniform mat4 uVP;uniform float uK;out vec4 vC;
void main(){vec4 p=uVP*vec4(aP,1.);gl_Position=p;gl_PointSize=clamp(aS*uK/p.w,1.,90.);vC=aC;}`;
const FS_PT = `#version 300 es
precision mediump float;in vec4 vC;out vec4 o;
void main(){vec2 c=gl_PointCoord*2.-1.;float d=dot(c,c);if(d>1.)discard;float a=exp(-d*3.2);float core=exp(-d*28.);o=vec4(vC.rgb*vC.a*(a*.9+core*1.4),1.);}`;
const VS_LN = `#version 300 es
in vec3 aP;in vec4 aC;uniform mat4 uVP;out vec4 vC;void main(){gl_Position=uVP*vec4(aP,1.);vC=aC;}`;
const FS_LN = `#version 300 es
precision mediump float;in vec4 vC;out vec4 o;void main(){o=vec4(vC.rgb*vC.a,1.);}`;
const VS_Q = `#version 300 es
out vec2 vU;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vU=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
const FS_DOWN = `#version 300 es
precision mediump float;in vec2 vU;uniform sampler2D uT;uniform float uTh;out vec4 o;void main(){vec3 c=texture(uT,vU).rgb;float l=max(max(c.r,c.g),c.b);o=vec4(c*smoothstep(uTh,uTh+.35,l),1.);}`;
const FS_BLUR = `#version 300 es
precision mediump float;in vec2 vU;uniform sampler2D uT;uniform vec2 uD;out vec4 o;
void main(){vec3 s=texture(uT,vU).rgb*.227;s+=texture(uT,vU+uD*1.385).rgb*.316;s+=texture(uT,vU-uD*1.385).rgb*.316;s+=texture(uT,vU+uD*3.231).rgb*.07;s+=texture(uT,vU-uD*3.231).rgb*.07;o=vec4(s,1.);}`;
// Nebula background (prototype default); the other experimental backdrops were not adopted.
const FS_COMP = `#version 300 es
precision mediump float;in vec2 vU;uniform sampler2D uS;uniform sampler2D uB1;uniform sampler2D uB2;uniform float uT;uniform float uTime;uniform vec2 uR;uniform vec2 uC;out vec4 o;
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=fract(sin(dot(i,vec2(127.1,311.7)))*43758.5),b=fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.5),c=fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.5),d=fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.5);return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n2(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){vec3 c=texture(uS,vU).rgb+texture(uB1,vU).rgb*.8+texture(uB2,vU).rgb*1.15;
 vec2 ar=vec2(uR.x/uR.y,1.);vec2 p=vU*ar*2.2;
 float lift=1.-smoothstep(.0,1.25,length((vU-vec2(.5,.52))*ar));vec3 bg=vec3(.034,.03,.026)+vec3(.05,.042,.032)*lift;
 float neb=fbm(p+vec2(uTime*.012,-uTime*.007)+fbm(p*.6-uTime*.01)*1.4);neb=smoothstep(.3,.95,neb);
 bg+=mix(vec3(.11,.085,.06),vec3(.045,.065,.13),smoothstep(.2,.9,vU.x+(vU.y-.5)*.4))*neb*1.3;
 float cg=1.-smoothstep(0.,.62,length((vU-uC)*ar));bg+=vec3(.07,.052,.032)*cg*cg;
 c+=bg;c=vec3(1.)-exp(-c*1.25);
 vec2 q=vU-.5;q.x*=uR.x/uR.y;c*=1.-smoothstep(.5,1.25,length(q))*.6;
 c+=(h(vU*uR+uT)-.5)*.022;o=vec4(max(c,0.),1.);}`;

type Program = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
type FrameBuffer = { t: WebGLTexture; f: WebGLFramebuffer; w: number; h: number };
type Lane = { p0: V3; p1: V3; p2: V3; p3: V3; st: Stage; parts: { u: number }[] };
const MAX_PT = 12000,
  MAX_LN = 30000;

export class EngineScene {
  private gl: WebGL2RenderingContext | null;
  private P: Record<string, Program> = {};
  private FB: Record<string, FrameBuffer> = {};
  private HALF = false;
  private ptBuf: WebGLBuffer | null = null;
  private lnBuf: WebGLBuffer | null = null;
  private vaoPt: WebGLVertexArrayObject | null = null;
  private vaoLn: WebGLVertexArrayObject | null = null;
  private PT = new Float32Array(8 * MAX_PT);
  private LN = new Float32Array(7 * MAX_LN);
  private np = 0;
  private nl = 0;
  private W = 0;
  private H = 0;
  private portrait = false;
  private lanes: Partial<Record<TelemetryChannelCode, Lane>> = {};
  private live = new Map<TelemetryChannelCode, TelemetryChannel>();
  private codes: TelemetryChannelCode[] = [];
  private heat = new Float32Array(OUT.p.length);
  private sparks: { p: V3; v: V3; l: number; m: number; c: V3; s: number }[] = [];
  private rings: { p: V3; n: V3; l: number; m: number }[] = [];
  private bursts: { at: number; st: Stage }[] = [];
  private embers: { i: number; ph: number; life: number }[] = [];
  private worldPts: V3[] = [];
  private CAM = { e: [sp(0), sp(0.4), sp(14)], c: [sp(0), sp(0), sp(0)] };
  private yaw = 0;
  private pitch = 0;
  private yawV = 0;
  private drag: { x: number; y: number; moved: number } | null = null;
  private mx = 0;
  private my = 0;
  private rotA = 0;
  private rotB = 0;
  private satelliteRoll = 0.4;
  private coreS = sp(0.2);
  private introK = sp(0);
  private clock = 0;
  private last = performance.now();
  private t0 = performance.now();
  private raf = 0;
  private CORE_PX = 100;
  private CORE_UV: [number, number] = [0.5, 0.5];
  private VP: number[] | null = null;
  private observer: ResizeObserver;
  private focus: Focus = null;
  private sel: TelemetryChannelCode | null = null;
  private lens: Lens = 'r';
  private hover: string | null = null;
  private satellite: V3 = [0, 0, 0];
  private evolutionPhase: EvolutionPhase | null = null;
  readonly webgl: boolean;

  constructor(
    private canvas: HTMLCanvasElement,
    private dom: SceneDom,
    private events: SceneEvents,
    private reduced: boolean,
    private demo = false,
  ) {
    this.gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: false, alpha: false });
    try {
      if (this.gl) this.initGL();
    } catch {
      this.gl = null;
    }
    this.webgl = !!this.gl;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    const ct = this.camTarget();
    this.CAM.e.forEach((s, i) => (s.x = ct.e[i] + (i === 2 && !reduced ? 6 : 0)));
    this.CAM.c.forEach((s, i) => (s.x = ct.c[i]));
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointerleave', this.onLeave);
    this.raf = requestAnimationFrame(this.frame);
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
  }
  /** A new snapshot: counts drive photons; completions since the previous snapshot drive bursts. */
  update(next: EngineTelemetry) {
    const prev = this.live;
    this.live = new Map(next.channels.map((c) => [c.code, c]));
    const changed = next.channels.map((c) => c.code).join() !== this.codes.join();
    this.codes = next.channels.map((c) => c.code);
    if (changed) this.buildLanes();
    if (this.reduced || prev.size === 0) return;
    for (const st of ['pr', 'out'] as const) {
      const n = next.channels
        .filter((c) => channelInfo[c.code].stage === st)
        .reduce((v, c) => v + completions(prev.get(c.code), c), 0);
      // Spread over the sampling interval; capped so a burst of completions stays legible.
      for (let i = 0; i < Math.min(3, n); i++)
        this.bursts.push({ at: this.clock + (i + 0.5) * (2.8 / Math.min(3, n)), st });
    }
  }
  setView(focus: Focus, sel: TelemetryChannelCode | null, lens: Lens) {
    this.focus = focus;
    this.sel = sel;
    this.lens = lens;
  }
  /** Hovering an HTML label highlights its lane or stage like hovering the 3D element. */
  hoverLabel(key: string | null) {
    this.hover = key;
  }
  setReduced(reduced: boolean) {
    this.reduced = reduced;
    if (reduced) {
      this.sparks.length = 0;
      this.rings.length = 0;
      this.bursts.length = 0;
    }
  }

  private V(code: TelemetryChannelCode): Values {
    const c = this.live.get(code);
    return c ? values(c) : ZERO;
  }
  private stCodes(st: Stage) {
    return this.codes.filter((c) => channelInfo[c].stage === st);
  }
  private sum(list: TelemetryChannelCode[]) {
    const t = { ...ZERO };
    list.forEach((c) => {
      const v = this.V(c);
      (Object.keys(t) as (keyof Values)[]).forEach((k) => (t[k] += v[k]));
    });
    return t;
  }
  private laneDef(st: Stage, i: number, n: number) {
    const k = n > 1 ? i / (n - 1) - 0.5 : 0;
    if (!this.portrait) {
      const sx = st === 'in' ? -1 : 1,
        far: V3 = [
          sx * 5.6,
          k * (st === 'in' ? 2.6 : 1.6) + (st === 'in' ? 0.15 : -0.1),
          (st === 'in' ? [-0.8, 0.4, -0.3][i] : [0.3, -0.5][i]) || 0,
        ];
      const dir = norm([sx, k * 0.45, far[2] * 0.15]),
        end = mul(dir, 1.06);
      return st === 'in'
        ? { p0: far, p1: [far[0] + 2.4, far[1], far[2]] as V3, p2: add(end, mul(dir, 1.5)), p3: end }
        : { p0: end, p1: add(end, mul(dir, 1.5)), p2: [far[0] - 2.4, far[1], far[2]] as V3, p3: far };
    }
    const sy = st === 'in' ? 1 : -1,
      far: V3 = [
        k * (st === 'in' ? 2.2 : 1.4),
        sy * 5.4,
        (st === 'in' ? [-0.6, 0.4, -0.2][i] : [0.3, -0.4][i]) || 0,
      ];
    const dir = norm([k * 0.45, sy, far[2] * 0.15]),
      end = mul(dir, 1.06);
    return st === 'in'
      ? { p0: far, p1: [far[0], far[1] - 2.2, far[2]] as V3, p2: add(end, mul(dir, 1.4)), p3: end }
      : { p0: end, p1: add(end, mul(dir, 1.4)), p2: [far[0], far[1] + 2.2, far[2]] as V3, p3: far };
  }
  private buildLanes() {
    this.lanes = {};
    (['in', 'out'] as const).forEach((st) => {
      const l = this.stCodes(st);
      l.forEach((c, i) => (this.lanes[c] = { ...this.laneDef(st, i, l.length), st, parts: [] }));
    });
  }

  /* ---------- GL ---------- */
  private sh(type: number, src: string) {
    const gl = this.gl!,
      s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  }
  private prog(vs: string, fs: string): Program {
    const gl = this.gl!,
      p = gl.createProgram()!;
    gl.attachShader(p, this.sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this.sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'program');
    const u: Program['u'] = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const a = gl.getActiveUniform(p, i)!;
      u[a.name] = gl.getUniformLocation(p, a.name);
    }
    return { p, u };
  }
  private initGL() {
    const gl = this.gl!;
    this.HALF = !!gl.getExtension('EXT_color_buffer_float');
    this.P = {
      pt: this.prog(VS_PT, FS_PT),
      ln: this.prog(VS_LN, FS_LN),
      down: this.prog(VS_Q, FS_DOWN),
      blur: this.prog(VS_Q, FS_BLUR),
      comp: this.prog(VS_Q, FS_COMP),
    };
    this.ptBuf = gl.createBuffer();
    this.vaoPt = gl.createVertexArray();
    gl.bindVertexArray(this.vaoPt);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ptBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.PT.byteLength, gl.DYNAMIC_DRAW);
    let L = (a: string) => gl.getAttribLocation(this.P.pt.p, a);
    gl.enableVertexAttribArray(L('aP'));
    gl.vertexAttribPointer(L('aP'), 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(L('aC'));
    gl.vertexAttribPointer(L('aC'), 4, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(L('aS'));
    gl.vertexAttribPointer(L('aS'), 1, gl.FLOAT, false, 32, 28);
    this.lnBuf = gl.createBuffer();
    this.vaoLn = gl.createVertexArray();
    gl.bindVertexArray(this.vaoLn);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lnBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.LN.byteLength, gl.DYNAMIC_DRAW);
    L = (a: string) => gl.getAttribLocation(this.P.ln.p, a);
    gl.enableVertexAttribArray(L('aP'));
    gl.vertexAttribPointer(L('aP'), 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(L('aC'));
    gl.vertexAttribPointer(L('aC'), 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
  }
  private mkFB(w: number, h: number): FrameBuffer {
    const gl = this.gl!,
      t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this.HALF ? gl.RGBA16F : gl.RGBA8,
      w,
      h,
      0,
      gl.RGBA,
      this.HALF ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f, w, h };
  }
  private freeFB() {
    const gl = this.gl;
    if (!gl) return;
    Object.values(this.FB).forEach((b) => {
      gl.deleteTexture(b.t);
      gl.deleteFramebuffer(b.f);
    });
    this.FB = {};
  }
  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.W = r.width;
    this.H = r.height;
    this.portrait = this.W < 760 && this.H > this.W;
    this.buildLanes();
    if (!this.gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    const w = this.canvas.width,
      h = this.canvas.height;
    this.freeFB();
    this.FB = {
      s: this.mkFB(w, h),
      a1: this.mkFB(w >> 1, h >> 1),
      b1: this.mkFB(w >> 1, h >> 1),
      a2: this.mkFB(Math.max(1, w >> 3), Math.max(1, h >> 3)),
      b2: this.mkFB(Math.max(1, w >> 3), Math.max(1, h >> 3)),
    };
  }
  private pt(p: V3, r: number, g: number, b: number, a: number, s: number) {
    if (this.np >= MAX_PT || a < 0.004) return;
    const o = this.np * 8,
      PT = this.PT;
    PT[o] = p[0];
    PT[o + 1] = p[1];
    PT[o + 2] = p[2];
    PT[o + 3] = r;
    PT[o + 4] = g;
    PT[o + 5] = b;
    PT[o + 6] = a;
    PT[o + 7] = s;
    this.np++;
  }
  private ln(a: V3, b: V3, r: number, g: number, bl: number, al: number) {
    if (this.nl >= MAX_LN - 2 || al < 0.003) return;
    this.LN.set([a[0], a[1], a[2], r, g, bl, al, b[0], b[1], b[2], r, g, bl, al], this.nl * 7);
    this.nl += 2;
  }

  /* ---------- camera ---------- */
  private spr(s: Spring, t: number, dt: number, k = 22) {
    if (this.reduced) {
      s.x = t;
      s.v = 0;
      return t;
    }
    const c = 2 * Math.sqrt(k);
    s.v += (-k * (s.x - t) - c * s.v) * dt;
    s.x += s.v * dt;
    return s.x;
  }
  private camTarget(): { e: V3; c: V3 } {
    const f = this.focus;
    if (this.portrait) {
      if (f === 'in') return { e: [0, 3.2, 6.4], c: [0, 2.4, 0] };
      if (f === 'out') return { e: [0, -2.6, 6.4], c: [0, -2.2, 0] };
      if (f === 'pr') return { e: [0, 0.4, 5.2], c: [0, -0.6, 0] };
      if (f === 'evo') return { e: [0, 4.6, 6.2], c: [0, -0.8, 0] };
      return { e: [0, 0.2, 11.2], c: [0, 0, 0] };
    }
    if (f === 'in') return { e: [-1.9, 0.5, 6.4], c: [-1.55, 0, 0] };
    if (f === 'out') return { e: [3.1, 0.4, 5.4], c: [2.9, 0, 0] };
    if (f === 'pr') return { e: [1.6, 0.45, 6.6], c: [1.45, 0, 0] };
    if (f === 'evo') return { e: [1.5, 4.4, 6.4], c: [1.3, -0.4, 0] };
    const aspectK = clamp(1.6 / (this.W / this.H || 1.6), 1, 1.5);
    return { e: [0, 0.18, 8.6 * aspectK], c: [0, -0.05, 0] };
  }
  private proj(VP: number[], p: V3) {
    const x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12],
      y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13],
      w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
    return { x: ((x / w) * 0.5 + 0.5) * this.W, y: (1 - ((y / w) * 0.5 + 0.5)) * this.H, w };
  }

  /* ---------- frame ---------- */
  private spawnSparks(at: V3, dirN: V3, n: number, col: V3, spd: number, life: number) {
    for (let i = 0; i < n; i++) {
      const r = norm(
        add(norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]), mul(dirN, 1.3)),
      );
      this.sparks.push({
        p: [...at] as V3,
        v: mul(r, spd * (0.4 + Math.random())),
        l: 0,
        m: life * (0.6 + Math.random() * 0.6),
        c: col,
        s: 0.025 + Math.random() * 0.035,
      });
    }
  }
  private heatAround(i: number, amt: number) {
    const heat = this.heat;
    heat[i] = Math.min(1.6, heat[i] + amt);
    OUT.adj[i].forEach((j) => {
      heat[j] = Math.min(1.4, heat[j] + amt * 0.6);
      OUT.adj[j].forEach((k) => (heat[k] = Math.min(1.2, heat[k] + amt * 0.25)));
    });
  }
  private nearestVert(p: V3) {
    let b = 0,
      bd = 1e9;
    this.worldPts.forEach((q, i) => {
      const d = len(sub(q, p));
      if (d < bd) {
        bd = d;
        b = i;
      }
    });
    return b;
  }
  private hlFor(code: TelemetryChannelCode) {
    const st = channelInfo[code].stage;
    if (this.sel) return this.sel === code ? 1.25 : 0.3;
    if (this.focus) return this.focus === st ? 1.1 : 0.3;
    if (this.hover) return this.hover === st || this.hover === code ? 1.25 : 0.55;
    return 1;
  }
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.W || document.visibilityState === 'hidden') {
      this.last = now;
      return;
    }
    const dt = Math.max(0, Math.min(1 / 30, (now - this.last) / 1000));
    this.last = now;
    if (!this.reduced) this.clock += dt;
    const t = this.clock,
      since = (now - this.t0) / 1000,
      reduced = this.reduced,
      motion = !reduced;
    this.np = 0;
    this.nl = 0;
    const TOT = this.sum(this.codes),
      act = TOT.r,
      prCodes = this.stCodes('pr'),
      prS = this.sum(prCodes);
    const phK = this.lens === 'r' || this.lens === 'd' ? 1 : 0.35,
      gateK = this.lens === 'q' ? 2.6 : 1;
    const ia = reduced ? 1 : clamp(this.spr(this.introK, since > 0.3 ? 1 : 0, dt, 9), 0, 1.2);
    const cs = this.spr(this.coreS, reduced || since > 1.1 ? 1 : 0.2, dt, reduced ? 1 : 7);
    // Core spin speeds up with real running records; frozen under reduced motion.
    if (motion) {
      this.rotA += dt * (0.07 + Math.min(act, 30) * 0.004);
      this.rotB = 0.28 + Math.sin(t * 0.07) * 0.12;
    } else this.rotB = 0.28;
    if (!this.drag) {
      this.yawV *= Math.pow(0.05, dt);
      this.yaw += this.yawV * dt;
      this.yaw *= Math.pow(0.6, dt);
      this.pitch *= Math.pow(0.5, dt);
    }
    const evo = evolutionFrame(t, this.demo, reduced);
    if (this.evolutionPhase !== evo.phase) {
      this.evolutionPhase = evo.phase;
      this.events.evolution(evo.phase);
    }
    const heat = this.heat;
    this.worldPts = OUT.p.map((p) => mul(rotX(rotY(p, this.rotA), this.rotB), cs));
    const worldPts = this.worldPts;
    // Repair the surface nearest the satellite, never a rotating far-side target.
    // Task photons and their counts are untouched.
    const repairOrigin = loopPt(IMPROVE, evo.angle);
    const targetIndex = this.nearestVert(repairOrigin);
    const patch = [targetIndex, ...OUT.adj[targetIndex]];
    if (evo.strength)
      patch.forEach((i, j) => {
        worldPts[i] = add(
          worldPts[i],
          mul(norm(worldPts[i]), 0.045 * Math.sin(j * 2.1) * evo.strength * (1 - evo.repair)),
        );
      });
    const inPts = INN.p.map((p) => mul(rotX(rotY(p, -this.rotA * 1.6), this.rotB + 0.4), cs));
    // Glowing clusters follow processing records; none when nothing runs.
    const want = Math.min(prS.r * 2 + (act ? 2 : 0), 26);
    while (this.embers.length < want)
      this.embers.push({
        i: Math.floor(Math.random() * OUT.p.length),
        ph: Math.random() * 6.28,
        life: 4 + Math.random() * 6,
      });
    if (this.embers.length > want) this.embers.length = want;
    this.embers.forEach((e) => {
      e.life -= dt;
      if (e.life < 0) {
        e.i = OUT.adj[e.i][Math.floor(Math.random() * OUT.adj[e.i].length)];
        e.life = 3 + Math.random() * 6;
      }
      const fl = 0.55 + 0.45 * Math.sin(t * (2.1 + e.ph) + e.ph * 3);
      heat[e.i] = Math.max(heat[e.i], 0.55 * fl);
      OUT.adj[e.i].forEach((j) => (heat[j] = Math.max(heat[j], 0.28 * fl)));
    });
    for (let i = 0; i < heat.length; i++) heat[i] *= Math.exp(-dt * 1.4);
    // Completion bursts: only scheduled from real snapshot deltas.
    this.bursts = this.bursts.filter((b) => {
      if (b.at > t) return true;
      const front = worldPts.map((p, i) => ({ i, z: p[2] })).filter((o) => o.z > 0.1);
      const pick = front.length ? front[Math.floor(Math.random() * front.length)].i : 0;
      const p = worldPts[pick],
        n = norm(p);
      this.heatAround(pick, 1.3);
      this.spawnSparks(p, n, 70, b.st === 'out' ? C_OUT : C_CH, 1.25, 1.3);
      this.rings.push({ p, n, l: 0, m: 1.1 });
      return false;
    });
    OUT.e.forEach(([i, j]) => {
      const a = worldPts[i],
        b = worldPts[j],
        z = (a[2] + b[2]) / 2 / cs,
        depth = 0.35 + 0.65 * clamp((z + 1) / 2, 0, 1),
        h = (heat[i] + heat[j]) / 2;
      const col = mix(C_SIL, mix(C_CH, [1, 0.97, 0.9], clamp(h - 0.6, 0, 1)), clamp(h * 1.4, 0, 1));
      this.ln(a, b, col[0], col[1], col[2], (0.085 * depth + h * 0.85 * depth) * ia);
    });
    INN.e.forEach(([i, j]) => this.ln(inPts[i], inPts[j], 0.62, 0.6, 0.57, 0.09 * ia));
    worldPts.forEach((p, i) => {
      const z = clamp((p[2] / cs + 1) / 2, 0, 1),
        h = Math.max(0, heat[i]);
      const col = h > 0 ? mix(C_SIL, C_CH, clamp(h * 1.5, 0, 1)) : C_SIL;
      this.pt(p, col[0], col[1], col[2], (0.22 + 0.5 * z + h * 0.8) * ia, 0.028 + h * 0.06);
    });
    this.pt([0, 0, 0], 1, 0.86, 0.62, (0.05 + 0.02 * Math.sin(t * 2.1)) * ia + (act ? 0.03 : 0), 2.4 * cs);
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const r = this.rings[k];
      r.l += dt;
      if (r.l > r.m) {
        this.rings.splice(k, 1);
        continue;
      }
      const u = r.l / r.m,
        rad = 0.08 + u * 0.7,
        a = (1 - u) * (1 - u) * 0.9;
      const t1 = norm(cross(r.n, [0, 1, 0.01])),
        t2 = cross(r.n, t1);
      for (let s = 0; s < 48; s++) {
        const ang = (s / 48) * 6.283;
        const q = add(add(r.p, mul(t1, Math.cos(ang) * rad)), mul(t2, Math.sin(ang) * rad));
        this.pt(add(q, mul(r.n, u * 0.08)), 1, 0.9, 0.72, a * 0.55, 0.035);
      }
    }
    for (let k = this.sparks.length - 1; k >= 0; k--) {
      const s = this.sparks[k];
      s.l += dt;
      if (s.l > s.m) {
        this.sparks.splice(k, 1);
        continue;
      }
      s.p = add(s.p, mul(s.v, dt));
      s.v = mul(s.v, Math.exp(-dt * 1.9));
      const u = s.l / s.m,
        a = Math.pow(1 - u, 1.6);
      const c = mix([1, 0.98, 0.92], s.c, clamp(u * 1.5, 0, 1));
      this.pt(s.p, c[0], c[1], c[2], a * 1.1, s.s * (1 - u * 0.5));
      this.pt(sub(s.p, mul(s.v, 0.035)), c[0], c[1], c[2], a * 0.4, s.s * 0.8);
    }
    // Work loop: processing photons, one per running record (max six per channel).
    const draw = reduced ? 1 : clamp((since - 0.15) / 1.6, 0, 1);
    const prHl =
      this.sel && prCodes.includes(this.sel)
        ? 1.15
        : this.focus && this.focus !== 'pr'
          ? 0.35
          : this.hover === 'pr'
            ? 1.25
            : 1;
    {
      let prev = loopPt(WORK, 0);
      const segs = 160;
      for (let k = 1; k <= segs * draw; k++) {
        const q = loopPt(WORK, (k / segs) * 6.283),
          fr = k / segs;
        const shimmer = 0.75 + 0.25 * Math.sin(fr * 6.283 * 2 - t * 0.6);
        this.ln(prev, q, ...C_CH, (prS.r ? 0.16 : 0.07) * shimmer * prHl);
        prev = q;
      }
      // Six route ticks on the work loop are markers only, not task positions.
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * 6.283 + 0.3;
        if (a / 6.283 > draw) continue;
        this.pt(loopPt(WORK, a), ...C_CH, 0.35 * prHl, 0.045);
      }
      if (motion) {
        let idx = 0;
        prCodes.forEach((code) => {
          const v = this.V(code),
            hl = this.sel ? (this.sel === code ? 1.3 : 0.35) : prHl;
          const n = particles(v.r, LANE_PARTICLES);
          for (let k = 0; k < n; k++, idx++) {
            const a0 = t * 0.32 + idx * 0.61;
            for (let j = 0; j < 6; j++)
              this.pt(
                loopPt(WORK, a0 - j * 0.022),
                ...mix([1, 0.96, 0.88], C_CH, j / 6),
                (1 - j / 6) * 0.62 * hl * draw * phK,
                0.05 - j * 0.004,
              );
          }
        });
      }
      // Queue motes at the loop entrance: one per queued record, at most ten.
      const pq = Math.min(prS.q, BEADS),
        gate = loopPt(WORK, Math.PI * 1.04);
      for (let k = 0; k < pq; k++) {
        const a = k * 2.4 + t * 0.12,
          r = 0.05 + (0.1 * ((k * 7) % 5)) / 5;
        this.pt(
          add(gate, [Math.cos(a) * r, Math.sin(a * 1.3) * r, Math.sin(a) * r * 0.5]),
          ...C_CH,
          0.3 * prHl * draw * gateK,
          0.032 * (gateK > 1 ? 1.4 : 1),
        );
      }
      if (prS.f)
        this.pt(
          loopPt(WORK, Math.PI * 1.1),
          ...C_CO,
          this.lens === 'f' ? 0.8 : 0.35,
          this.lens === 'f' ? 0.2 : 0.09,
        );
      if (this.lens === 'u' && prS.u) this.pt(loopPt(WORK, Math.PI * 0.9), 0.85, 0.77, 0.95, 0.75, 0.18);
    }
    // Patrol satellite: parked in real mode; repair choreography is demo-only.
    {
      const blue: V3 = [0.55, 0.76, 1];
      const evHl = this.focus === 'evo' || this.hover === 'evo' ? 1.3 : this.focus ? 0.35 : 0.8;
      const visibility = (p: V3) => {
        if (!this.VP) return 1;
        const q = this.proj(this.VP, p),
          c = this.proj(this.VP, [0, 0, 0]);
        const d = Math.hypot(q.x - c.x, q.y - c.y);
        return q.w > c.w && d < this.CORE_PX * 0.9 ? 0.02 : q.w > c.w ? 0.5 : 1;
      };
      const line = (a: V3, b: V3, alpha: number) =>
        this.ln(a, b, ...blue, alpha * evHl * visibility(mix(a, b, 0.5)));
      const point = (p: V3, alpha: number, size: number) =>
        this.pt(p, ...blue, alpha * evHl * visibility(p), size);
      for (let k = 0; k < 200 * draw; k++) {
        const a = (k / 200) * Math.PI * 2;
        const distance = Math.abs(Math.atan2(Math.sin(a - evo.angle), Math.cos(a - evo.angle)));
        line(
          loopPt(IMPROVE, a),
          loopPt(IMPROVE, a + Math.PI / 100),
          0.085 + (evo.active ? 0.28 * Math.max(0, 1 - distance / 0.65) : 0),
        );
      }
      const sat = (this.satellite = loopPt(IMPROVE, evo.angle));
      const tangent = norm(sub(loopPt(IMPROVE, evo.angle + 0.01), sat));
      const radial = norm(sat),
        normal = norm(cross(tangent, radial));
      const roll = (this.satelliteRoll = advanceSatelliteRoll(this.satelliteRoll, dt, evo));
      const wing = add(mul(radial, Math.cos(roll)), mul(normal, Math.sin(roll)));
      point(sat, 1.05, 0.06);
      point(sat, 0.18 + evo.strength * 0.08, 0.19);
      for (const side of [-1, 1]) {
        const wingPt = (a: number) =>
          add(sat, add(mul(tangent, Math.cos(a) * 0.14), mul(wing, Math.sin(a) * 0.095 * side)));
        // One understated wing-tip light makes the symmetric wings' rotation legible.
        if (side === 1) point(wingPt(1.4), 0.25 + evo.strength * 0.35, 0.022);
        for (let k = 0; k < 24; k++) {
          const a = 0.25 + (k / 24) * 2.35;
          line(wingPt(a), wingPt(a + 2.35 / 24), 0.85);
        }
      }
      if (evo.active) {
        for (let k = 1; k <= 16; k++)
          point(loopPt(IMPROVE, evo.angle - k * 0.013), 0.43 * (1 - k / 17), 0.028);
        if (evo.strength) {
          const target = worldPts[targetIndex];
          // Short local fan: approach from outside the nearby surface without circling the core.
          const scanPath = (end: V3, u: number) => bz(sat, mul(sat, 0.82), mul(end, 1.18), end, u);
          patch.slice(1, 4).forEach((i) => {
            for (let k = 0; k < 28; k++)
              line(scanPath(worldPts[i], k / 28), scanPath(worldPts[i], (k + 1) / 28), 0.13 * evo.strength);
          });
          patch.forEach((i) => {
            const color = mix(blue, C_CH, evo.repair);
            this.pt(worldPts[i], ...color, 0.85 * evo.strength * visibility(worldPts[i]), 0.05);
          });
          for (const i of patch.slice(1)) {
            const color = mix(blue, C_CH, evo.repair);
            this.ln(target, worldPts[i], ...color, 0.48 * evo.strength * visibility(target));
          }
          if (evo.phase === '修复中')
            for (let k = 0; k < 2; k++)
              point(scanPath(target, ((evo.cycle - 9) * 0.7 + k * 0.5) % 1), 0.9, 0.05);
        }
      }
    }
    // Input / output light flows.
    (Object.keys(this.lanes) as TelemetryChannelCode[]).forEach((code, li) => {
      const L = this.lanes[code]!,
        v = this.V(code),
        hl = this.hlFor(code),
        col = L.st === 'in' ? C_IN : C_OUT;
      let prev = L.p0;
      for (let s = 1; s <= 60; s++) {
        const q = bz(L.p0, L.p1, L.p2, L.p3, s / 60);
        this.ln(
          prev,
          q,
          ...col,
          (v.r ? 0.08 : 0.035) * hl * ia * (L.st === 'in' ? Math.min(1, s / 10) : Math.min(1, (60 - s) / 10)),
        );
        prev = q;
      }
      const n = motion ? particles(v.r) : 0;
      while (L.parts.length < n) L.parts.push({ u: Math.random() });
      L.parts.length = n;
      L.parts.forEach((pp, k) => {
        pp.u += dt * (L.st === 'in' ? 0.2 : 0.26) * (1 + k * 0.07);
        if (pp.u >= 1) {
          pp.u -= 1;
          if (L.st === 'in') {
            this.heatAround(this.nearestVert(L.p3), 0.9);
            this.spawnSparks(L.p3, norm(L.p3), 9, C_CH, 0.7, 0.7);
          } else this.spawnSparks(L.p0, norm(L.p0), 5, C_OUT, 0.5, 0.5);
        }
        for (let j = 0; j < 7; j++) {
          const u = pp.u - j * 0.007;
          if (u < 0) break;
          const q = bz(L.p0, L.p1, L.p2, L.p3, u),
            fade = L.st === 'in' ? Math.min(1, u * 5) : Math.min(1, (1 - u) * 5);
          this.pt(
            q,
            ...mix([0.95, 0.95, 0.95], col, 0.4 + j / 12),
            (1 - j / 7) * 0.55 * fade * hl * ia * phK,
            0.048 - j * 0.004,
          );
        }
      });
      // Gate: queue motes wait at the entrance, one per queued record, at most ten.
      const gq = Math.min(v.q, BEADS),
        gc = L.st === 'in' ? bz(L.p0, L.p1, L.p2, L.p3, 0.06) : bz(L.p0, L.p1, L.p2, L.p3, 0.12);
      for (let k = 0; k < gq; k++) {
        const a = k * 2.4 + t * 0.15,
          r = 0.08 + (0.12 * ((k * 7) % 5)) / 5;
        this.pt(
          add(gc, [Math.cos(a) * r * 0.6, Math.sin(a * 1.3) * r, Math.sin(a) * r * 0.5]),
          ...col,
          0.26 * hl * ia * gateK,
          0.03 * (gateK > 1 ? 1.4 : 1),
        );
      }
      if (v.f)
        this.pt(
          gc,
          ...C_CO,
          this.lens === 'f' ? 0.7 + 0.25 * Math.sin(t * 3 + li) : 0.3,
          this.lens === 'f' ? 0.2 : 0.08,
        );
      if (v.u && this.lens === 'u') this.pt(gc, 0.85, 0.77, 0.95, 0.7, 0.18);
      if (v.w && this.lens === 'w') this.pt(gc, ...col, 0.6, 0.16);
    });
    DUST.forEach((d) =>
      this.pt(d.p, 0.85, 0.8, 0.72, d.a * (0.6 + 0.4 * Math.sin(t * 0.5 + d.ph)) * ia, d.s),
    );
    // Camera
    const tg = this.camTarget();
    const e = tg.e.map((v, i) => this.spr(this.CAM.e[i], v, dt, this.focus ? 14 : 10)) as V3,
      c = tg.c.map((v, i) => this.spr(this.CAM.c[i], v, dt, this.focus ? 14 : 10)) as V3;
    const drift = reduced ? 0 : 1;
    const orbitYaw = this.yaw + drift * Math.sin(t * 0.05) * 0.08 + this.mx * 0.06 * drift,
      orbitPitch = this.pitch + this.my * 0.04 * drift;
    let eye = sub(e, c);
    eye = rotY(eye, orbitYaw);
    eye = rotX(eye, clamp(orbitPitch, -0.6, 0.6));
    eye = add(eye, c);
    const VP = mm(persp((38 * Math.PI) / 180, this.W / this.H, 0.1, 80), lookAt(eye, c, [0, 1, 0]));
    this.VP = VP;
    const cp = this.proj(VP, [0, 0, 0]);
    this.CORE_UV = [cp.x / this.W, 1 - cp.y / this.H];
    if (this.gl) this.render(VP);
    this.placeLabels(VP);
  };
  private render(VP: number[]) {
    const gl = this.gl!,
      P = this.P,
      FB = this.FB,
      w = this.canvas.width,
      h = this.canvas.height;
    if (!FB.s) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, FB.s.f);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(P.ln.p);
    gl.uniformMatrix4fv(P.ln.u.uVP, false, VP);
    gl.bindVertexArray(this.vaoLn);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lnBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.LN, 0, this.nl * 7);
    gl.drawArrays(gl.LINES, 0, this.nl);
    gl.useProgram(P.pt.p);
    gl.uniformMatrix4fv(P.pt.u.uVP, false, VP);
    gl.uniform1f(P.pt.u.uK, h / 2 / Math.tan((19 * Math.PI) / 180));
    gl.bindVertexArray(this.vaoPt);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ptBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.PT, 0, this.np * 8);
    gl.drawArrays(gl.POINTS, 0, this.np);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    const pass = (pr: Program, src: FrameBuffer, dst: FrameBuffer, set: (p: Program) => void) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.useProgram(pr.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.t);
      gl.uniform1i(pr.u.uT, 0);
      set(pr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    pass(P.down, FB.s, FB.a1, (p) => gl.uniform1f(p.u.uTh, 0.22));
    for (let k = 0; k < 2; k++) {
      pass(P.blur, FB.a1, FB.b1, (p) => gl.uniform2f(p.u.uD, 1 / FB.a1.w, 0));
      pass(P.blur, FB.b1, FB.a1, (p) => gl.uniform2f(p.u.uD, 0, 1 / FB.a1.h));
    }
    pass(P.down, FB.a1, FB.a2, (p) => gl.uniform1f(p.u.uTh, 0));
    for (let k = 0; k < 3; k++) {
      pass(P.blur, FB.a2, FB.b2, (p) => gl.uniform2f(p.u.uD, 1.5 / FB.a2.w, 0));
      pass(P.blur, FB.b2, FB.a2, (p) => gl.uniform2f(p.u.uD, 0, 1.5 / FB.a2.h));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(P.comp.p);
    (
      [
        [FB.s, 'uS'],
        [FB.a1, 'uB1'],
        [FB.a2, 'uB2'],
      ] as const
    ).forEach(([f, n], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, f.t);
      gl.uniform1i(P.comp.u[n], i);
    });
    gl.uniform1f(P.comp.u.uT, this.clock % 10);
    gl.uniform1f(P.comp.u.uTime, this.clock);
    gl.uniform2f(P.comp.u.uR, w, h);
    gl.uniform2f(P.comp.u.uC, this.CORE_UV[0], this.CORE_UV[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* ---------- HUD placement ---------- */
  private placeLabels(VP: number[]) {
    const { W, H, focus } = this,
      dom = this.dom;
    const panelOpen = !!focus && W >= 760,
      pLeft = panelOpen && focus === 'in',
      pw = dom.panel.offsetWidth,
      maxX = panelOpen && !pLeft ? W - pw - 60 : W - 16,
      minX = pLeft ? 28 + pw + 24 : 12,
      topY = dom.top.offsetHeight + 10;
    const placed: Partial<Record<TelemetryChannelCode, { x: number; y: number; w: number }>> = {};
    this.codes.forEach((code) => {
      const el = dom.labels[code];
      if (!el) return;
      const st = channelInfo[code].stage,
        L = this.lanes[code];
      if (st === 'pr' || !L) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        return;
      }
      const anchor = bz(
        L.p0,
        L.p1,
        L.p2,
        L.p3,
        st === 'in' ? (this.portrait ? 0.02 : 0.1) : this.portrait ? 0.98 : 0.9,
      );
      const side = this.portrait ? 'c' : st === 'in' ? 'r' : 'l';
      const s = this.proj(VP, anchor),
        w = el.offsetWidth,
        h = el.offsetHeight;
      let x = side === 'r' ? s.x - w - 14 : side === 'c' ? s.x - w / 2 : s.x + 14,
        y = s.y - h / 2;
      x = clamp(x, minX, Math.max(minX, maxX - w));
      y = clamp(y, topY, H - h - (focus ? 16 : 70));
      el.style.transform = `translate3d(${x}px,${y}px,0)`;
      el.classList.toggle('r', side === 'r');
      placed[code] = { x, y, w };
      const vis = s.w > 0 && (!focus || focus === st);
      el.style.opacity = vis ? (this.sel && this.sel !== code ? '.35' : '1') : '0';
      el.style.pointerEvents = vis ? 'auto' : 'none';
    });
    const place = (st: Stage | 'evo', x: number, y: number) => {
      const el = dom.caps[st];
      if (!el) return;
      el.style.transform = `translate3d(${x}px,${y}px,0)`;
      el.style.opacity = focus ? '0' : '1';
      el.style.pointerEvents = focus ? 'none' : 'auto';
    };
    (['in', 'out'] as const).forEach((st) => {
      const el = dom.caps[st];
      const rows = this.stCodes(st)
        .map((c) => placed[c])
        .filter((r) => !!r);
      if (!el || !rows.length) return;
      if (this.portrait) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        return;
      }
      const x0 = Math.min(...rows.map((r) => r.x)),
        x1 = Math.max(...rows.map((r) => r.x + r.w)),
        y0 = Math.min(...rows.map((r) => r.y));
      const w = el.offsetWidth,
        h = el.offsetHeight;
      place(st, st === 'in' ? Math.max(8, x1 - w) : Math.min(W - w - 8, x0), Math.max(topY, y0 - h - 10));
    });
    for (const [st, L, a, off] of [
      ['pr', WORK, this.portrait ? Math.PI : 0, this.portrait ? -0.28 : 0.28],
      ['evo', IMPROVE, this.portrait ? 0 : Math.PI, this.portrait ? 0.3 : -0.3],
    ] as const) {
      const el = dom.caps[st];
      if (!el) continue;
      const s = this.proj(VP, add(loopPt(L, a), mul(L.u, off))),
        w = el.offsetWidth,
        h = el.offsetHeight;
      place(
        st,
        clamp(s.x - w / 2, 8, W - w - 8),
        clamp(s.y - h / 2, topY, H - h - (st === 'evo' && this.portrait ? 90 : 64)),
      );
    }
    const c0 = this.proj(VP, [0, 0, 0]),
      c1 = this.proj(VP, [1.12, 0, 0]);
    const rad = Math.max(40, Math.hypot(c1.x - c0.x, c1.y - c0.y));
    dom.halo.style.width = `${rad * 2.7}px`;
    dom.halo.style.height = `${rad * 2.7}px`;
    this.CORE_PX = rad;
    dom.haloWrap.style.transform = `translate3d(${c0.x}px,${c0.y}px,0)`;
    dom.haloWrap.style.opacity = focus && focus !== 'pr' ? '.3' : '1';
    dom.coreNum.style.transform = `translate3d(${c0.x}px,${c0.y}px,0) translate(-50%,-50%) scale(${focus && focus !== 'pr' ? 0.6 : 1})`;
    dom.coreNum.style.opacity = focus && focus !== 'pr' ? '.5' : '1';
  }

  /* ---------- pointer ---------- */
  private hitTest(e: PointerEvent): Hit | null {
    const VP = this.VP;
    if (!VP) return null;
    const r = this.canvas.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top;
    let best: Hit | null = null,
      bd = 14;
    const near = (pts: V3[], o: Hit) => {
      for (const p of pts) {
        const s = this.proj(VP, p);
        if (s.w <= 0) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
    };
    (Object.keys(this.lanes) as TelemetryChannelCode[]).forEach((code) => {
      const L = this.lanes[code]!,
        pts: V3[] = [];
      for (let i = 2; i <= 40; i++) pts.push(bz(L.p0, L.p1, L.p2, L.p3, i / 42));
      near(pts, { kind: 'lane', st: L.st, code });
    });
    const lp = (L: { u: V3; v: V3 }) => Array.from({ length: 80 }, (_, i) => loopPt(L, (i / 80) * 6.283));
    near(lp(WORK), { kind: 'loop', st: 'pr' });
    near(lp(IMPROVE), { kind: 'loop', st: 'evo' });
    const sat = this.proj(VP, this.satellite),
      center = this.proj(VP, [0, 0, 0]);
    if (
      !(sat.w > center.w && Math.hypot(sat.x - center.x, sat.y - center.y) < this.CORE_PX * 0.9) &&
      Math.hypot(sat.x - x, sat.y - y) < 18
    )
      return { kind: 'loop', st: 'evo' };
    const c0 = this.proj(VP, [0, 0, 0]);
    if (Math.hypot(c0.x - x, c0.y - y) < this.CORE_PX * 0.9) best = { kind: 'core' };
    return best;
  }
  private onDown = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
    this.canvas.classList.add('drag');
    this.canvas.setPointerCapture?.(e.pointerId);
  };
  private onMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.mx = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.my = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (this.drag) {
      const dx = e.clientX - this.drag.x,
        dy = e.clientY - this.drag.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.yaw -= dx * 0.005;
      this.pitch = clamp(this.pitch + dy * 0.004, -0.6, 0.6);
      this.yawV = -dx * 0.3;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (this.drag.moved > 6) {
        this.setHover(null, 0, 0);
        return;
      }
    }
    const h = this.hitTest(e);
    this.setHover(h, e.clientX - r.left, e.clientY - r.top);
  };
  private onUp = (e: PointerEvent) => {
    const moved = !!this.drag && this.drag.moved > 6;
    this.drag = null;
    this.canvas.classList.remove('drag');
    if (moved) return;
    const h = this.hitTest(e);
    if (h) {
      if (h.kind === 'core') return;
      this.events.pick(h.st, h.kind === 'lane' ? h.code : null);
    } else if (this.focus) this.events.home();
  };
  private onLeave = () => this.setHover(null, 0, 0);
  private setHover(h: Hit | null, x: number, y: number) {
    this.hover = !h ? null : h.kind === 'lane' ? h.code : h.kind === 'loop' ? h.st : null;
    this.canvas.style.cursor = !h ? '' : h.kind === 'core' ? 'grab' : 'pointer';
    this.events.hover(h, x, y);
  }
}
