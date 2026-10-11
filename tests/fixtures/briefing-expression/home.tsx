/**
 * Approved design reference (2026-10-11) for the briefing card faces: white glass cards, the
 * type colour only as accent, graphics that own the card. Packed by the real magazine grid.
 * Synthetic content only; no session, API or model calls. Several forms shown here (trend,
 * share strip, decorative art) wait for verified calculations before reaching the product.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChartNoAxesCombined, FileCheck2, Lightbulb, Newspaper, Signpost } from 'lucide-react';
import { magazineGridMetrics, packMagazineTiles } from '../../../src/briefingGrid';
import type { CardSize } from '../../../src/briefing';
import '../../../src/shared/theme.css';
import './home.css';

const amount = (n: number) => n.toLocaleString('en-US');
const signed = (n: number) => (n > 0 ? '+' : '') + amount(n);
const wan = (n: number) => (n / 10000).toFixed(1);

const typeIcons = {
  资讯: Newspaper,
  数据: ChartNoAxesCombined,
  洞察: Lightbulb,
  建议: Signpost,
  成果: FileCheck2,
};
type CardType = keyof typeof typeIcons;
type Box = { w: number; h: number };

function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<Box>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = { w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) };
      setBox((old) => (old.w === next.w && old.h === next.h ? old : next));
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, box] as const;
}

/** Card shell: optional full-bleed art underneath, content on top with the standard 20px inset. */
function Card({
  type,
  time,
  art,
  artHover = false,
  children,
  ...props
}: {
  type: CardType;
  time: string;
  art?: ReactNode;
  artHover?: boolean;
  children: ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const Icon = typeIcons[type];
  return (
    <article className="h-card" data-type={type} {...props}>
      {art}
      <div className={`h-content${artHover ? ' is-passive' : ''}`}>
        <div className="h-eyebrow">
          <span className="h-chip">
            <Icon size={13} aria-hidden="true" />
            {type}
          </span>
          <time>{time}</time>
        </div>
        {children}
      </div>
    </article>
  );
}

function Wash({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" className="h-stop-top" />
      <stop offset="1" className="h-stop-end" />
    </linearGradient>
  );
}
/** The wash thins out before the last point, so nothing blocky sits to the right of it. */
function Fade({ id, end, w, h }: { id: string; end: number; w: number; h: number }) {
  return (
    <>
      <linearGradient id={`${id}-fade`} x1="0" x2="1" y1="0" y2="0">
        <stop offset={(end - 70) / w} stopColor="#fff" />
        <stop offset={(end + 2) / w} stopColor="#000" />
      </linearGradient>
      <mask id={`${id}-mask`}>
        <rect x={-6} width={w + 6} height={h} fill={`url(#${id}-fade)`} />
      </mask>
    </>
  );
}

/* ================= 数据 ================= */

function MetricCard({
  w,
  h,
  id,
  caption,
  value,
  note,
  points,
}: Box & { id: string; caption: string; value: string; note: string; points: number[] }) {
  const min = Math.min(...points),
    max = Math.max(...points);
  const top = h * 0.74,
    bottom = h - 16,
    end = w - 22,
    last = points.length - 1;
  const x = (i: number) => -6 + (i * (end + 6)) / last;
  const y = (n: number) => bottom - ((n - min) / (max - min)) * (bottom - top);
  const line = points.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
  return (
    <Card
      type="数据"
      time="9月30日"
      art={
        <svg className="h-art" width={w} height={h} aria-hidden="true">
          <defs>
            <Wash id={id} />
            <Fade id={id} end={end} w={w} h={h} />
          </defs>
          <path
            className="h-wash"
            d={`${line} L${end},${h} L-6,${h} Z`}
            fill={`url(#${id})`}
            mask={`url(#${id}-mask)`}
          />
          <path className="h-line" d={line} pathLength={1} />
          <circle className="h-dot" cx={x(last)} cy={y(points[last])} r={4.5} />
        </svg>
      }
    >
      <p className="h-caption">{caption}</p>
      <div className="h-hero">
        <strong>{value}</strong>
        <span>元</span>
      </div>
      <small className="h-note">{note}</small>
    </Card>
  );
}

const weekly = [58200, 61400, 57900, 66300, 71800, 69200, 64100, 73600, 78900, 74200, 81500, 92400];
const mean = weekly.reduce((s, n) => s + n, 0) / weekly.length;
function TrendCard({ w, h }: Box) {
  const [active, setActive] = useState<number | null>(null);
  const last = weekly.length - 1;
  const shown = active ?? last;
  const min = Math.min(...weekly) * 0.94,
    max = Math.max(...weekly);
  const left = -6,
    right = w - 30,
    top = h * 0.56,
    bottom = h - 40;
  const x = (i: number) => left + (i * (right - left)) / last;
  const y = (n: number) => bottom - ((n - min) / (max - min)) * (bottom - top);
  const line = weekly.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
  return (
    <Card
      type="数据"
      time="9月30日"
      onMouseLeave={() => setActive(null)}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const i = Math.round(((e.clientX - rect.left - left) / (right - left)) * last);
        setActive(Math.max(0, Math.min(last, i)));
      }}
      art={
        <svg className="h-art" width={w} height={h} role="img" aria-label="近十二周每周收款">
          <defs>
            <Wash id="trend" />
            <Fade id="trend" end={right} w={w} h={h} />
          </defs>
          <path
            className="h-wash"
            d={`${line} L${right},${h} L-6,${h} Z`}
            fill="url(#trend)"
            mask="url(#trend-mask)"
          />
          <line className="h-rule" x1={0} x2={w} y1={y(mean)} y2={y(mean)} />
          <path className="h-line" d={line} pathLength={1} />
          {active !== null && active !== last && (
            <>
              <line className="h-cross" x1={x(active)} x2={x(active)} y1={top - 6} y2={bottom + 6} />
              <circle className="h-dot" cx={x(active)} cy={y(weekly[active])} r={4.5} />
            </>
          )}
          <circle className="h-dot" cx={x(last)} cy={y(weekly[last])} r={5.5} />
        </svg>
      }
    >
      <div className="h-headline">
        <h3 className="h-title">收款连续五周高于均值</h3>
        <div className="h-value">
          <div className="h-hero">
            <strong>{wan(weekly[shown])}</strong>
            <span>万元</span>
          </div>
          <small>
            {active === null
              ? '最近一周 · 高于均值 30.5%'
              : `第 ${shown + 1} 周 · 较均值 ${signed(Math.round(weekly[shown] - mean))}`}
          </small>
        </div>
      </div>
      <footer className="h-push">经营分析 · 近 12 周 · 细线为均值</footer>
    </Card>
  );
}

const stores = [
  { name: '门店 A', from: 82400, to: 91200 },
  { name: '门店 B', from: 76900, to: 64300 },
  { name: '门店 C', from: 58200, to: 73500 },
  { name: '门店 D', from: 44600, to: 38900 },
  { name: '门店 E', from: null as number | null, to: 47400 },
];
/** Keep end labels at least `gap` apart without detaching them far from their marks. */
function spread(positions: (number | null)[], gap: number) {
  const order = positions
    .map((y, i) => ({ y, i }))
    .filter((d): d is { y: number; i: number } => d.y !== null)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++)
    if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
  const out = [...positions];
  for (const d of order) out[d.i] = d.y;
  return out;
}
function PeriodCard({ w, h }: Box) {
  const focus = 2;
  const [active, setActive] = useState<number | null>(null);
  const shown = active ?? focus;
  const s = stores[shown];
  const delta = s.from === null ? null : s.to - s.from;
  const narrow = w < 400;
  const headBottom = 20 + 24 + 10 + 65 + 10 + 54 + 12;
  const bandL = narrow ? 66 : 136,
    bandR = narrow ? 124 : 136;
  const x1 = bandL,
    x2 = w - bandR,
    top = headBottom + 46,
    bottom = h - 60;
  const values = stores.flatMap((d) => (d.from === null ? [d.to] : [d.from, d.to]));
  const min = Math.min(...values),
    max = Math.max(...values);
  const y = (n: number) => bottom - ((n - min) / (max - min)) * (bottom - top);
  const left = spread(
    stores.map((d) => (d.from === null ? null : y(d.from))),
    18,
  );
  const right = spread(
    stores.map((d) => y(d.to)),
    18,
  );
  return (
    <Card
      type="数据"
      time="9月30日"
      artHover
      art={
        <svg className="h-art" width={w} height={h} role="img" aria-label="五家门店八月到九月收款变化">
          <rect className="h-band" x={-20} y={headBottom} width={bandL + 20} height={h} rx={18} />
          <rect className="h-band" x={w - bandR} y={headBottom} width={bandR + 20} height={h} rx={18} />
          <text className="h-tick" x={bandL - 12} y={headBottom + 24} textAnchor="end">
            8月
          </text>
          <text className="h-tick" x={w - bandR + 12} y={headBottom + 24}>
            9月
          </text>
          {stores.map((d, i) => {
            const tone = d.from === null ? 'is-new' : d.to >= d.from ? 'is-up' : 'is-down';
            return (
              <g
                key={d.name}
                className={`h-slope ${tone}${shown === i ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              >
                {d.from !== null && (
                  <>
                    <line className="h-hit" x1={x1} y1={y(d.from)} x2={x2} y2={y(d.to)} />
                    <line
                      className="h-stroke"
                      x1={x1}
                      y1={y(d.from)}
                      x2={x2}
                      y2={y(d.to)}
                      pathLength={1}
                      style={{ animationDelay: `${i * 0.08}s` }}
                    />
                    <circle className="h-dot" cx={x1} cy={y(d.from)} r={4.5} />
                    <text className="h-end" x={x1 - 12} y={left[i]! + 4} textAnchor="end">
                      {amount(d.from)}
                    </text>
                    {!narrow && (
                      <text className="h-name" x={20} y={left[i]! + 4}>
                        {d.name}
                      </text>
                    )}
                  </>
                )}
                <circle className="h-dot" cx={x2} cy={y(d.to)} r={4.5} />
                <text className="h-end" x={x2 + 12} y={right[i]! + 4}>
                  {amount(d.to)}
                </text>
                <text className="h-name" x={w - 20} y={right[i]! + 4} textAnchor="end">
                  {d.name}
                </text>
              </g>
            );
          })}
        </svg>
      }
    >
      <h3 className="h-title">两店上升两店回落，门店 C 涨幅最大</h3>
      <div className="h-lead">
        <div className="h-hero">
          <strong>
            {delta === null ? '新开' : signed(Number(((delta / s.from!) * 100).toFixed(1))) + '%'}
          </strong>
        </div>
        <small>
          <b>{s.name}</b>
          {delta === null ? '仅本期有数据，不参与增减比较' : `${amount(s.from!)} → ${amount(s.to)} 元`}
        </small>
      </div>
      <footer className="h-push is-centered">
        <span className="h-legend">
          <i className="is-up" />
          上升
          <i className="is-down" />
          回落
        </span>
      </footer>
    </Card>
  );
}

const statuses = [
  { label: '在读', value: 268 },
  { label: '请假', value: 52 },
  { label: '冻结', value: 31 },
  { label: '已结课', value: 22 },
  { label: '已退课', value: 14 },
  { label: '已取消', value: 11 },
];
function ShareCard({ w, h }: Box) {
  const [active, setActive] = useState<number | null>(null);
  const total = statuses.reduce((s, d) => s + d.value, 0);
  const shown = active ?? 0;
  const strip = h < 260 ? 40 : 48;
  return (
    <Card
      type="数据"
      time="9月30日"
      artHover
      art={
        <div className="h-strip" style={{ height: strip }} onMouseLeave={() => setActive(null)}>
          {statuses.map((d, i) => (
            <i
              key={d.label}
              className={`tone-${Math.min(i, 3)}${active !== null && active !== i ? ' is-dim' : ''}`}
              style={{ flexGrow: d.value, animationDelay: `${i * 0.05}s` }}
              onMouseEnter={() => setActive(i)}
            >
              {(d.value / total) * w >= 56 && <b>{d.label}</b>}
            </i>
          ))}
        </div>
      }
    >
      <div className="h-headline">
        <h3 className="h-title">在读课程占三分之二</h3>
        <div className="h-value">
          <div className="h-hero">
            <strong>{((statuses[shown].value / total) * 100).toFixed(1)}</strong>
            <span>%</span>
          </div>
          <small>
            {statuses[shown].label} {statuses[shown].value} 条 · 共 {total} 条
          </small>
        </div>
      </div>
      <footer className="h-push" style={{ marginBottom: strip - 6 }}>
        会员管理 · 请假与冻结合计两成
      </footer>
    </Card>
  );
}

const coaches = [
  { name: '教练甲', value: 186 },
  { name: '教练乙', value: 164 },
  { name: '教练丙', value: 151 },
  { name: '教练丁', value: 118 },
  { name: '教练戊', value: 97 },
];
function RankCard({ h }: Box) {
  const rows = coaches.slice(0, h >= 400 ? 5 : 3);
  return (
    <Card type="数据" time="9月30日">
      <h3 className="h-title">教练甲消课领先 22 节</h3>
      <ol className="h-rank">
        {rows.map((d, i) => (
          <li key={d.name} className={i === 0 ? 'is-lead' : ''}>
            <span className="h-rank-no">{i + 1}</span>
            <span className="h-rank-body">
              <span>
                {d.name}
                <b>{d.value}</b>
              </span>
              <i
                style={{ width: `${(d.value / coaches[0].value) * 100}%`, animationDelay: `${i * 0.07}s` }}
              />
            </span>
          </li>
        ))}
      </ol>
      <footer>教学管理 · 九月有效消课 · 节</footer>
    </Card>
  );
}

const deposits = [
  { name: '门店 B', confirmed: 65900, canceled: 12700 },
  { name: '门店 D', confirmed: 64800, canceled: 7900 },
  { name: '门店 A', confirmed: 176200, canceled: 4100 },
  { name: '门店 E', confirmed: 73400, canceled: 2600 },
];
function BarsCard({ w, h }: Box) {
  const wide = w >= 400;
  const rows = deposits.slice(0, wide ? (h >= 260 ? 4 : 3) : 4);
  const max = Math.max(...deposits.map((d) => d.confirmed + d.canceled));
  const list = (
    <div className="h-bars">
      {rows.map((d, i) => (
        <div key={d.name} className={i === 0 ? 'is-lead' : ''}>
          <span>{d.name}</span>
          <span className="h-bar-track">
            <i style={{ width: `${(d.confirmed / max) * 92}%`, animationDelay: `${i * 0.06}s` }} />
            <i
              className="is-warm"
              style={{ width: `${(d.canceled / max) * 92}%`, animationDelay: `${0.2 + i * 0.06}s` }}
            />
          </span>
          <b>{((d.canceled / (d.confirmed + d.canceled)) * 100).toFixed(1)}%</b>
        </div>
      ))}
    </div>
  );
  return (
    <Card type="数据" time="9月28日">
      <div className={wide ? 'h-split' : 'h-stack'}>
        <div className="h-col">
          <h3 className="h-title is-three">门店 B 已取消定金最多</h3>
          <footer className="h-push">
            <span className="h-legend">
              <i className="is-up is-block" />
              已确认
              <i className="is-down is-block" />
              已取消
            </span>
          </footer>
        </div>
        <div className="h-col is-middle">
          <small className="h-col-head">已取消占比</small>
          {list}
        </div>
      </div>
    </Card>
  );
}

/* ================= 资讯 ================= */

function Arcs({ w, h, cx, cy, count = 7 }: Box & { cx: number; cy: number; count?: number }) {
  return (
    <svg className="h-art" width={w} height={h} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <ellipse
          key={i}
          className="h-arc"
          cx={cx}
          cy={cy}
          rx={46 + i * 34}
          ry={24 + i * 20}
          style={{ animationDelay: `${i * 0.06}s` }}
        />
      ))}
    </svg>
  );
}
function NewsCoverCard({ w, h }: Box) {
  const cover = Math.round(h * 0.4);
  return (
    <Card
      type="资讯"
      time="10月7日"
      art={
        <div className="h-cover" style={{ height: cover }}>
          <Arcs w={w} h={cover} cx={w * 0.68} cy={cover * 1.08} count={9} />
          <span>配图示意</span>
        </div>
      }
    >
      <div style={{ height: cover - 34, flex: 'none' }} />
      <h3 className="h-title">场馆配套做得专业，维护成本更低、复购更高</h3>
      <p className="h-summary is-three">
        行业案例显示，配套在需求阶段就介入、按需选型并保证售后响应，可以避免二次改造。一家商业篮球公园翻新地面与照明后，复购率提升近四成。
      </p>
      {h >= 440 && (
        <blockquote className="h-quote is-spaced">
          <span>解读</span>
          对门店的参考：器械与地面的维护记录值得纳入月度检查，问题越早发现，停用时间越短。
        </blockquote>
      )}
      <footer className="h-push">运营管理 · 2 个来源 · 另有 1 段解读</footer>
    </Card>
  );
}
function NewsCard({ w, h }: Box) {
  return (
    <Card type="资讯" time="10月5日" art={<Arcs w={w} h={h} cx={w - 10} cy={h + 6} />}>
      <h3 className="h-title">假日体旅融合升温，门店可借势做本地活动</h3>
      <p className="h-summary">
        政策推动全民健身与文旅结合，假日赛事带动跨区域消费。“运动加休闲”的活动形式值得门店参考。
      </p>
      <footer className="h-push">市场观察 · 3 个来源</footer>
    </Card>
  );
}

/* ================= 洞察 ================= */

function InsightCard({ w }: Box) {
  return (
    <Card type="洞察" time="10月6日" art={<span className="h-glyph">”</span>}>
      <div className={w >= 400 ? 'h-split' : 'h-stack'}>
        <div className="h-col">
          <h3 className="h-title is-three">取消的定金集中在两家门店</h3>
          <footer className="h-push">依据：收款明细、订单明细</footer>
        </div>
        <div className="h-col is-middle">
          <blockquote className="h-quote">
            <span>观察</span>
            门店 B 与门店 D 的已取消定金合计占全部取消金额的七成五，其余三家很少发生。
          </blockquote>
        </div>
      </div>
    </Card>
  );
}
function InsightSmallCard() {
  return (
    <Card type="洞察" time="10月5日" art={<span className="h-glyph is-small">”</span>}>
      <h3 className="h-title is-compact is-four">新开门店首月收款已超过门店 D</h3>
      <footer className="h-push">依据：收款明细</footer>
    </Card>
  );
}

/* ================= 建议 ================= */

function StepsCard({ h }: Box) {
  const steps = [
    '核对门店 B 九月排课与在籍会员变化',
    '跟进待复核收款的财务确认',
    '月底前复查已取消定金的后续处理',
  ];
  return (
    <Card type="建议" time="10月6日">
      <h3 className="h-title is-three">先核对门店 B，再确认待复核收款</h3>
      <ol className="h-steps">
        {steps.slice(0, h >= 400 ? 3 : 2).map((text, i) => (
          <li key={i} style={{ animationDelay: `${0.1 + i * 0.1}s` }}>
            <b>{i + 1}</b>
            <span>{text}</span>
          </li>
        ))}
      </ol>
      <footer>
        <span className="h-caution">需留意</span>回落原因尚无依据
      </footer>
    </Card>
  );
}
function SuggestionSmallCard() {
  return (
    <Card
      type="建议"
      time="10月4日"
      art={
        <svg className="h-art h-corner" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="92" cy="92" r="62" />
          <path d="M62 92h44M90 74l18 18-18 18" />
        </svg>
      }
    >
      <h3 className="h-title is-compact is-three">给请假超过 30 天的会员安排一次回访</h3>
      <footer className="h-push">下一步 · 导出名单</footer>
    </Card>
  );
}

/* ================= 成果 ================= */

function Sheets({ small = false }: { small?: boolean }) {
  return (
    <svg className={`h-sheets${small ? ' is-small' : ''}`} viewBox="0 0 220 200" aria-hidden="true">
      {[
        { x: 78, y: 54, r: 9 },
        { x: 52, y: 40, r: 3 },
        { x: 26, y: 28, r: -4 },
      ].map((s, i) => (
        <g
          key={i}
          transform={`translate(${s.x} ${s.y}) rotate(${s.r})`}
          style={{ animationDelay: `${i * 0.1}s` }}
        >
          <rect className="h-sheet" width="132" height="176" rx="10" />
          {i === 2 && (
            <>
              <rect className="h-sheet-head" x="16" y="18" width="62" height="9" rx="4.5" />
              {[44, 58, 72, 86].map((y, k) => (
                <rect
                  key={y}
                  className="h-sheet-line"
                  x="16"
                  y={y}
                  width={k === 3 ? 58 : 100}
                  height="5"
                  rx="2.5"
                />
              ))}
              <rect className="h-sheet-chart" x="16" y="108" width="100" height="44" rx="6" />
            </>
          )}
        </g>
      ))}
    </svg>
  );
}
function ResultCard({ w }: Box) {
  return (
    <Card type="成果" time="10月6日" art={<Sheets small={w < 400} />}>
      <div className="h-textside">
        <h3 className="h-title is-three">九月经营周报已整理成稿</h3>
        <p className="h-summary">收款、会员与消课三部分，附待核对事项。</p>
      </div>
      <footer className="h-push">文稿 · 4 页 · 待审阅</footer>
    </Card>
  );
}
function ResultSmallCard() {
  return (
    <Card type="成果" time="10月3日" art={<Sheets small />}>
      <h3 className="h-title is-compact is-three h-textside">请假会员回访名单</h3>
      <footer className="h-push">表格 · 49 人</footer>
    </Card>
  );
}

/* ================= 页面 ================= */

const tiles: { id: string; type: CardType; size: CardSize; render: (box: Box) => ReactNode }[] = [
  { id: 'period', type: '数据', size: '2×2', render: (box) => <PeriodCard {...box} /> },
  { id: 'news-cover', type: '资讯', size: '2×2', render: (box) => <NewsCoverCard {...box} /> },
  {
    id: 'metric',
    type: '数据',
    size: '1×1',
    render: (box) => (
      <MetricCard
        {...box}
        id="metric-a"
        caption="九月收款近五个月最高"
        value="315,300"
        note="▲ 20.3% 较 8 月"
        points={[236000, 248500, 271200, 262100, 315300]}
      />
    ),
  },
  { id: 'steps', type: '建议', size: '1×2', render: (box) => <StepsCard {...box} /> },
  { id: 'trend', type: '数据', size: '2×1', render: (box) => <TrendCard {...box} /> },
  { id: 'insight', type: '洞察', size: '2×1', render: (box) => <InsightCard {...box} /> },
  { id: 'result', type: '成果', size: '2×1', render: (box) => <ResultCard {...box} /> },
  { id: 'insight-small', type: '洞察', size: '1×1', render: () => <InsightSmallCard /> },
  { id: 'share', type: '数据', size: '2×1', render: (box) => <ShareCard {...box} /> },
  { id: 'rank', type: '数据', size: '1×2', render: (box) => <RankCard {...box} /> },
  { id: 'news', type: '资讯', size: '2×1', render: (box) => <NewsCard {...box} /> },
  { id: 'suggestion-small', type: '建议', size: '1×1', render: () => <SuggestionSmallCard /> },
  { id: 'bars', type: '数据', size: '2×1', render: (box) => <BarsCard {...box} /> },
  {
    id: 'metric-2',
    type: '数据',
    size: '1×1',
    render: (box) => (
      <MetricCard
        {...box}
        id="metric-b"
        caption="待复核收款占一成六"
        value="51,300"
        note="占 9 月收款 16.3%"
        points={[38200, 44100, 41800, 47600, 51300]}
      />
    ),
  },
  { id: 'result-small', type: '成果', size: '1×1', render: () => <ResultSmallCard /> },
];

function Slot({ render }: { render: (box: Box) => ReactNode }) {
  const [ref, box] = useBox<HTMLDivElement>();
  return (
    <div ref={ref} className="h-slot">
      {box.w > 0 && box.h > 0 && render(box)}
    </div>
  );
}

const filters = ['全部', '资讯', '数据', '洞察', '建议', '成果'] as const;
function Home() {
  const [ref, page] = useBox<HTMLDivElement>();
  const [filter, setFilter] = useState<(typeof filters)[number]>('全部');
  const { columns, unit } = magazineGridMetrics(Math.min(1600, page.w));
  const shown = tiles.filter((tile) => filter === '全部' || tile.type === filter);
  const placements = packMagazineTiles(
    shown.map((tile) => ({ id: tile.id, size: tile.size, fixed: true })),
    columns,
  );
  const byId = new Map(tiles.map((tile) => [tile.id, tile]));
  return (
    <main className="h-page">
      <header className="h-top">
        <div>
          <h1>智能画报</h1>
          <span>10月11日 星期日 · 合成演示内容</span>
        </div>
        <nav aria-label="类型">
          {filters.map((name) => (
            <button key={name} type="button" aria-pressed={filter === name} onClick={() => setFilter(name)}>
              {name}
            </button>
          ))}
        </nav>
      </header>
      <div ref={ref}>
        {page.w > 0 && (
          <div
            className="h-grid"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gridAutoRows: unit,
              maxWidth: 1600,
            }}
          >
            {placements.map((p) => (
              <div
                key={p.id}
                className="h-tile"
                style={{
                  gridColumn: `${p.col + 1} / span ${p.width}`,
                  gridRow: `${p.row + 1} / span ${p.height}`,
                }}
              >
                <Slot render={byId.get(p.id)!.render} />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Home />);
