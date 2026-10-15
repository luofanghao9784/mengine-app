import { useEffect, useLayoutEffect, useState } from 'react';
import type { Asset } from './foundation-api';
import { GATES } from './world';

/** 五个环节的分段进度：已过的环节点亮，卡住的那一环标出来。 */
export function Stages({ a }: { a: Asset }) {
  return (
    <span className="stages" aria-hidden="true">
      {GATES.map((g, i) => (
        <i
          key={g}
          data-state={(i === 4 ? a.available : i < a.gate) ? 'done' : i === a.gate ? 'held' : 'wait'}
        />
      ))}
    </span>
  );
}

/** 读数：业务数据看记录、可用、隔离、质量；资料看质量、密级、版本、标签。 */
export function readouts(a: Asset): [string, string | number][] {
  return a.kind === 'table'
    ? [
        ['记录', a.total ?? '—'],
        ['可用', a.ready ?? '—'],
        ['隔离', a.isolated],
        ['质量', a.quality],
      ]
    : [
        ['质量', a.quality],
        ['密级', `L${a.classification}`],
        ['版本', `v${a.version}`],
        ['标签', a.tags.length],
      ];
}

/** 可展开的一行：标题、右侧的简短信息和展开箭头；展开后是缩进的正文。 */
export function Fold({
  title,
  meta,
  tone,
  open,
  children,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  tone?: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="fold" open={open}>
      <summary>
        {tone && <i className={`dot tone-${tone}`} />}
        <span className="fold-title">{title}</span>
        {meta !== undefined && <span className="fold-meta">{meta}</span>}
        <span className="chev" aria-hidden="true" />
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

/** 时间线：左边是时间，右边是事件。 */
export function Timeline({
  items,
}: {
  items: { at: string; text: React.ReactNode; note?: React.ReactNode }[];
}) {
  return (
    <ol className="timeline">
      {items.map((x, i) => (
        <li key={i}>
          <time className="num">{x.at}</time>
          <span>
            {x.text}
            {x.note && <small>{x.note}</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * 聚光：一束柔光跟着指针走，照在卡面上，并让离指针近的卡片边缘亮起来。
 * 几张卡共用这一束光——指针从一张卡移到另一张，光是连续滑过去的。
 * 只写 CSS 变量（--mx、--my 光的位置，--near 0–1 的靠近程度），具体画法在样式表里。
 */
export function useSpotlight(root: React.RefObject<HTMLElement | null>, reach = 90) {
  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0,
      x = 0,
      y = 0;
    const paint = () => {
      raf = 0;
      el.querySelectorAll<HTMLElement>('[data-spot]').forEach((card) => {
        const r = card.getBoundingClientRect();
        const dx = Math.max(r.left - x, 0, x - r.right),
          dy = Math.max(r.top - y, 0, y - r.bottom),
          near = Math.max(0, 1 - Math.hypot(dx, dy) / reach);
        card.style.setProperty('--mx', `${(x - r.left).toFixed(0)}px`);
        card.style.setProperty('--my', `${(y - r.top).toFixed(0)}px`);
        card.style.setProperty('--near', near.toFixed(3));
      });
    };
    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const leave = () => {
      x = y = -1e4;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      cancelAnimationFrame(raf);
    };
  }, [root, reach]);
}

/** 列表里选中框的位置：选中项变了，选中框从旧位置滑到新位置，而不是直接跳过去。 */
export function useGlide(list: React.RefObject<HTMLElement | null>, selected: string, ...deps: unknown[]) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(selected)}"]`);
    setBox(row ? { top: row.offsetTop, height: row.offsetHeight } : null);
  }, [list, selected, ...deps]);
  return box;
}
