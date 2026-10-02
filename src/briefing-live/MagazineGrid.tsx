import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CardSize } from '../briefing';
import { magazineGridMetrics, packMagazineTiles } from '../briefingGrid';
import { useBriefingCardFit } from '../components/useBriefingCardFit';
import './magazine-grid.css';

export type MagazineGridItem = {
  id: string;
  title: string;
  summary: string;
  chart?: boolean;
  wide?: boolean;
  fixedSize?: CardSize;
  append?: boolean;
  render: ReactNode;
};
const selectors = { cards: '.live-briefing-tile', button: '.live-briefing-body' };
export function MagazineGrid({ items }: { items: MagazineGridItem[] }) {
  const grid = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ columns: 1, unit: 254 });
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const next = magazineGridMetrics(element.clientWidth);
      if (next.unit <= 0) return;
      setMetrics((old) => (old.columns === next.columns && old.unit === next.unit ? old : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const identity = items.map((i) => i.id + i.title + i.summary + i.wide + i.fixedSize).join('|');
  const fit = useBriefingCardFit(
    grid,
    identity + metrics.columns + ':' + metrics.unit,
    metrics.columns,
    metrics.unit,
    selectors,
  );
  const placements = packMagazineTiles(
    items.map((item) => {
      const preferred: CardSize =
        item.fixedSize ||
        (item.chart
          ? '2×2'
          : item.wide || item.title.length > 28 || item.summary.length > 110
            ? '2×1'
            : '1×1');
      const minimum = item.fixedSize ? undefined : fit[item.id];
      return {
        id: item.id,
        size: (minimum
          ? `${Math.max(Number(preferred[0]), Number(minimum.size[0]))}×${Math.max(Number(preferred[2]), Number(minimum.size[2]))}`
          : preferred) as CardSize,
        fixed: !!minimum || item.wide || !!item.fixedSize,
        append: item.append,
        rows: minimum?.rows,
      };
    }),
    metrics.columns,
  );
  const previous = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const next = new Map<string, { x: number; y: number }>();
    for (const element of grid.current?.querySelectorAll<HTMLElement>('.live-briefing-tile') || []) {
      const id = element.dataset.cardId!,
        position = { x: element.offsetLeft, y: element.offsetTop };
      const old = previous.current.get(id);
      if (
        old &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches &&
        (old.x !== position.x || old.y !== position.y)
      ) {
        element.getAnimations().forEach((a) => a.cancel());
        element.animate(
          [
            { transform: `translate(${old.x - position.x}px, ${old.y - position.y}px)` },
            { transform: 'none' },
          ],
          { duration: 220, easing: 'cubic-bezier(.2,.65,.25,1)' },
        );
      }
      next.set(id, position);
    }
    previous.current = next;
  });
  const content = new Map(items.map((item) => [item.id, item.render]));
  return (
    <div
      ref={grid}
      className="live-briefing-grid live-magazine-grid"
      data-packed="true"
      style={
        { '--briefing-columns': metrics.columns, '--briefing-unit': `${metrics.unit}px` } as CSSProperties
      }
    >
      {placements.map((p) => (
        <div
          key={p.id}
          className="live-briefing-tile"
          data-card-id={p.id}
          data-size={p.size}
          style={{ gridColumn: `${p.col + 1} / span ${p.width}`, gridRow: `${p.row + 1} / span ${p.height}` }}
        >
          {content.get(p.id)}
        </div>
      ))}
    </div>
  );
}
