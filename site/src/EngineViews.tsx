import { useEffect, useMemo, useRef, useState } from 'react';
import { Database, FileStack, FileText, Library, MessageSquareText, type LucideIcon } from 'lucide-react';
import { EngineScene, type Focus, type SceneDom } from './engine/engine-stage/scene';
import { busySnapshot } from './engine/engine-demo';
import { channelInfo } from './engine/engine-dashboard-model';
import './engine/engine-stage/engine-stage.css';
import { useReducedMotion } from './hooks';

const caps = { in: '输入', pr: '工作循环', out: '输出', evo: '自进化循环' } as const;

/* 讲到输入、输出时，光流两端的标签展开成卡片：数据从哪来，成果到哪去。卡片由 3D 场景逐帧定位，跟着镜头走。 */
// tag 是官网上这条通道的叫法；不写就沿用产品仪表盘的通道名。输出两条在仪表盘里叫“会话流式输出”“成果导出”，是给运维看的说法，官网另起。
const ends: Record<string, { icon: LucideIcon; name: string; line: string; tag?: string }> = {
  COLLECTION: { icon: Database, name: '业务系统', line: '收款、会员、订单' },
  KNOWLEDGE: { icon: FileStack, name: '上传的文件', line: '文档、表格、拍照的单据' },
  RETRIEVAL: { icon: Library, name: '团队资料库', line: '已有的资料和历史成果' },
  RESPONSE: { icon: MessageSquareText, name: '会话回答', line: '每个结论都带着出处', tag: '逐段返回' },
  EXPORT: { icon: FileText, name: '成果文件', line: '文稿、表格，留给团队接着用', tag: '保存与共享' },
};

interface Key {
  focus: Focus;
  zoom: number;
  shift: number;
  labels: boolean;
  only: string;
  mid: number;
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 整页唯一的一台引擎。镜头不再等某一章“到位”才切换，而是按页面滚动的位置在相邻两章的视角之间连续插值，
 * 手滚到哪，镜头就到哪。各章的视角写在章节元素的 data-focus / data-zoom / data-shift 上。
 */
export function EngineBackdrop() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<EngineScene | null>(null);
  const labels = useRef<SceneDom['labels']>({});
  const capEls = useRef<SceneDom['caps']>({});
  const top = useRef<HTMLDivElement>(null);
  const reserve = useRef<HTMLDivElement>(null);
  const haloWrap = useRef<HTMLDivElement>(null);
  const halo = useRef<HTMLDivElement>(null);
  const core = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [at, setAt] = useState(Date.now);
  const [near, setNear] = useState<{ focus: Focus; labels: boolean; only: string }>({ focus: null, labels: false, only: '' });
  const value = useMemo(() => busySnapshot(at), [at]);

  useEffect(() => {
    const s = new EngineScene(
      canvas.current!,
      {
        top: top.current!,
        labels: labels.current,
        caps: capEls.current,
        haloWrap: haloWrap.current!,
        halo: halo.current!,
        coreNum: core.current!,
        panel: reserve.current!,
      },
      { evolution() {}, pick() {}, home() {}, hover() {} },
      reduced,
      true,
    );
    s.pinEnds = true;
    scene.current = s;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setAt(Date.now());
    }, 3000);

    let keys: Key[] = [];
    const measure = () => {
      keys = [...document.querySelectorAll<HTMLElement>('.chapter')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          focus: (el.dataset.focus || null) as Focus,
          zoom: Number(el.dataset.zoom ?? 1),
          shift: Number(el.dataset.shift ?? 0),
          labels: el.dataset.labels !== undefined,
          only: el.dataset.labels || '',
          mid: r.top + scrollY + r.height / 2,
        };
      });
      follow();
    };
    let last = '';
    const follow = () => {
      if (!keys.length) return;
      const y = scrollY + innerHeight / 2;
      let i = 0;
      while (i < keys.length - 2 && y >= keys[i + 1].mid) i++;
      const from = keys[i],
        to = keys[Math.min(i + 1, keys.length - 1)];
      // 每一章的中段镜头停稳，方便读字；两章之间的那段滚动用来移动镜头。
      const k = to === from ? 0 : smooth(0.22, 0.78, (y - from.mid) / (to.mid - from.mid));
      s.blend = { from, to, k };
      const n = k < 0.5 ? from : to;
      const id = `${n.focus}|${n.labels}|${n.only}`;
      if (id !== last) {
        last = id;
        s.setView(n.focus, null, 'r');
        setNear({ focus: n.focus, labels: n.labels, only: n.only });
      }
    };
    measure();
    addEventListener('scroll', follow, { passive: true });
    addEventListener('resize', measure);
    return () => {
      clearInterval(timer);
      removeEventListener('scroll', follow);
      removeEventListener('resize', measure);
      s.destroy();
      scene.current = null;
    };
  }, [reduced]);
  useEffect(() => scene.current?.update(value), [value, reduced]);

  const running = value.channels.reduce((n, c) => n + c.running, 0);
  return (
    <>
      <canvas ref={canvas} className="backdrop-gl" aria-hidden="true" />
      <div className="eng-overlay" data-motion={reduced ? 'reduced' : 'full'} data-focus={near.labels || undefined} data-stage={near.focus || undefined} data-only={near.only || undefined} aria-hidden="true">
        <div ref={top} className="eng-top" />
        {/* 场景按这块的大小给文字面板让位：宽屏让出一侧，窄屏让出下方。 */}
        <div ref={reserve} className="eng-reserve" />
        {value.channels
          .filter((c) => channelInfo[c.code].stage !== 'pr')
          .map((c) => {
            const stage = channelInfo[c.code].stage;
            const end = ends[c.code];
            const tag = end?.tag ?? channelInfo[c.code].name;
            return (
              <div
                key={c.code}
                className="eng3d-lbl"
                data-end={stage}
                ref={(el) => {
                  if (el) labels.current[c.code] = el;
                  else delete labels.current[c.code];
                }}
              >
                {near.focus === stage && end ? (
                  <div className="end-card">
                    <i><end.icon size={20} strokeWidth={1.6} /></i>
                    <p><b>{end.name}</b><span>{end.line}</span></p>
                    <em><small>{tag}</small>{c.running}</em>
                  </div>
                ) : (
                  <>
                    <span className="n">{tag}</span>
                    <span className="v" style={{ color: stage === 'in' ? '#D6E2EE' : '#F0BE72' }}>{c.running}</span>
                  </>
                )}
              </div>
            );
          })}
        {(['in', 'pr', 'out', 'evo'] as const).map((st) => (
          <div
            key={st}
            className={`eng3d-cap ${st === 'evo' ? 'evo' : ''}`}
            ref={(el) => {
              if (el) capEls.current[st] = el;
            }}
          >
            {caps[st]}
          </div>
        ))}
        <div className="eng3d-halowrap" ref={haloWrap}>
          <div className="eng3d-halo" ref={halo} data-active />
        </div>
        <div className="eng3d-core" ref={core}>
          <b>{running}</b>
          <span>执行中</span>
        </div>
        <p className="eng-note">演示数据</p>
      </div>
    </>
  );
}
