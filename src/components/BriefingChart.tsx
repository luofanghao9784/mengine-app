import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { chartDescription, type BriefingChart as Chart } from '../briefingPresentation';
import { briefingPeriod } from '../briefingTypography';

const blue = '#356cd4',
  light = '#98b6e8',
  gray = '#dbe3ef',
  ink = '#23334b',
  muted = '#617087',
  amber = '#b78643';
const palette = [blue, light, gray];
const number = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function BriefingChart({ chart, spacious }: { chart: Chart; spacious: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(260);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(120, entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const height = spacious ? 172 : 74;
  const small = width < 280;
  const rows = chart.rows;
  const marks: ReactNode[] = [];
  let seq = 0;
  const text = (
    x: number,
    y: number,
    value: ReactNode,
    anchor: 'start' | 'middle' | 'end' = 'start',
    color = ink,
  ) =>
    marks.push(
      <text key={seq++} x={x} y={y} textAnchor={anchor} fill={color}>
        {value}
      </text>,
    );
  const rect = (x: number, y: number, w: number, h: number, fill: string, rx = 0) =>
    marks.push(
      <rect key={seq++} x={x} y={y} width={Math.max(0, w)} height={Math.max(0, h)} fill={fill} rx={rx} />,
    );
  const line = (x1: number, y1: number, x2: number, y2: number, stroke = gray, sw = 1) =>
    marks.push(<line key={seq++} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} />);
  const dot = (x: number, y: number, r = 4, fill = blue) =>
    marks.push(<circle key={seq++} cx={x} cy={y} r={r} fill={fill} />);
  const total = rows.reduce((sum, d) => sum + d.value, 0);
  if (chart.kind === 'line' || chart.kind === 'area') {
    const left = Math.max(28, number(Math.max(...rows.map((d) => d.value), 1)).length * 7 + 10),
      right = width - 15,
      top = 20,
      bottom = height - 22,
      max = Math.max(...rows.map((d) => d.value), 1);
    const x = (i: number) => left + (i * (right - left)) / Math.max(rows.length - 1, 1),
      y = (v: number) => bottom - (v / max) * (bottom - top);
    line(left, bottom, right, bottom);
    text(left - 7, bottom + 3, '0', 'end', muted);
    text(left - 7, top + 3, number(max), 'end', muted);
    // The upper guide would cross the value labels in a shallow plot.
    if (spacious) line(left, top, right, top, '#eef1f6');
    const points = rows.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
    if (chart.kind === 'area')
      marks.push(
        <polygon key={seq++} points={`${left},${bottom} ${points} ${right},${bottom}`} fill="#e9f0fc" />,
      );
    marks.push(
      <polyline
        key={seq++}
        points={points}
        fill="none"
        stroke={blue}
        strokeWidth="2"
        strokeLinejoin="round"
      />,
    );
    rows.forEach((d, i) => {
      dot(x(i), y(d.value), 3);
      const anchor = i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle';
      text(x(i), y(d.value) - 8, number(d.value), anchor);
      // Narrow reading cards keep endpoints and the middle tick legible.
      if (
        !small ||
        rows.length <= 4 ||
        i === 0 ||
        i === rows.length - 1 ||
        i === Math.floor((rows.length - 1) / 2)
      )
        text(x(i), height - 3, d.label, anchor, muted);
    });
  } else if (chart.kind === 'stacked') {
    let offset = 0;
    const denominator = chart.total || total || 1;
    rows.forEach((d, i) => {
      const w = (width * d.value) / denominator;
      rect(offset, 5, w, spacious ? 30 : 12, palette[i % 3]);
      offset += w;
    });
    rows.forEach((d, i) => {
      // Keep the legend below the entire bar, even in a one-row card.
      const y = (spacious ? 58 : 34) + i * (spacious ? 30 : 18);
      rect(0, y - 7, 7, 7, palette[i % 3]);
      text(14, y, d.label);
      text(width, y, `${number(d.value)} ${chart.unit}`, 'end');
    });
  } else if (chart.kind === 'bullet') {
    const limit = chart.target || total || 1,
      right = width - 8,
      paid = rows[0]?.value || 0,
      pending = rows[1]?.value || 0,
      scale = right / Math.max(limit, paid + pending);
    const y = spacious ? 50 : 22;
    text(0, 14, `已支付 ${number(paid)} ${chart.unit}`);
    text(right, 14, `上限 ${number(limit)}`, 'end', muted);
    rect(0, y, right, spacious ? 28 : 24, '#edf1f6', 3);
    rect(0, y + 5, (paid + pending) * scale, 14, light, 2);
    rect(0, y + 5, paid * scale, 14, blue, 2);
    line(limit * scale, y - 3, limit * scale, y + (spacious ? 33 : 28), ink, 2);
    text(
      0,
      y + (spacious ? 49 : 45),
      `待支付 ${number(pending)} · 未使用 ${number(rows[2]?.value || 0)} ${chart.unit}`,
      'start',
      muted,
    );
    if (spacious) text(0, y + 78, '预算占用与实际支付分别核对', 'start', muted);
  } else if (chart.kind === 'lollipop' || chart.kind === 'dumbbell') {
    const left = small ? 74 : 100,
      compactPair = chart.kind === 'dumbbell' && !spacious,
      right = width - (compactPair ? 70 : 22),
      max = Math.max(1, ...rows.flatMap((d) => [d.value, d.previous || 0]));
    const rowHeight = (height - (chart.kind === 'dumbbell' ? 24 : 12)) / Math.max(rows.length, 1),
      x = (v: number) => left + (v / max) * (right - left);
    rows.forEach((d, i) => {
      const y = compactPair ? 12 + i * 24 : 12 + i * rowHeight + (chart.kind === 'dumbbell' ? 8 : 0);
      text(0, y + 4, d.label);
      if (d.previous !== undefined) {
        line(x(d.previous), y, x(d.value), y, light, 3);
        marks.push(
          <circle key={seq++} cx={x(d.previous)} cy={y} r={4} fill="white" stroke={light} strokeWidth="2" />,
        );
        if (compactPair) {
          // A separate value column avoids labels landing on the next row's marks.
          text(width, y + 4, `${number(d.previous)} → ${number(d.value)}`, 'end');
        } else {
          text(x(d.previous), y - 9, number(d.previous), 'middle', muted);
          text(x(d.value), y + 17, number(d.value), 'middle');
        }
      } else {
        line(left, y, x(d.value), y, gray, 2);
        text(x(d.value) + 9, y + 4, number(d.value));
      }
      dot(x(d.value), y, 4);
    });
  } else if (chart.kind === 'waffle') {
    const count = Math.min(60, Math.round(total)),
      columns = count <= 15 ? 6 : 10,
      gap = 5;
    const size = Math.min(spacious ? 26 : 19, (width - 6 * (columns - 1)) / columns),
      gridRows = Math.ceil(count / columns);
    // Large populations use proportional cells; truncating raw counts distorts the share.
    const exactCells = rows.map((d) => (total > 0 ? (Math.max(0, d.value) / total) * count : 0));
    const cells = exactCells.map(Math.floor);
    const remainderOrder = exactCells
      .map((n, i) => ({ i, remainder: n - cells[i] }))
      .sort((a, b) => b.remainder - a.remainder);
    for (let i = 0, remaining = count - cells.reduce((a, n) => a + n, 0); i < remaining; i++)
      cells[remainderOrder[i % rows.length].i]++;
    let current = 0;
    rows.forEach((d, k) => {
      for (let i = 0; i < cells[k] && current < count; i++, current++)
        rect(
          (current % columns) * (size + gap),
          4 + Math.floor(current / columns) * (size + gap),
          size,
          size,
          palette[k % 3],
          3,
        );
    });
    const y = 4 + gridRows * (size + gap) + 12;
    rows.forEach((d, i) => {
      const x = i * (width / rows.length);
      rect(x, y - 7, 6, 6, palette[i % 3]);
      text(x + 10, y, `${d.label} ${d.value}`);
    });
  } else if (chart.kind === 'ring') {
    const r = spacious ? 54 : 27,
      cx = r + 8,
      cy = spacious ? 72 : height / 2,
      circumference = 2 * Math.PI * r,
      denominator = chart.total || total || 1;
    marks.push(
      <circle
        key={seq++}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="#eaf0f8"
        strokeWidth={spacious ? 12 : 9}
      />,
    );
    marks.push(
      <circle
        key={seq++}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={blue}
        strokeWidth={spacious ? 12 : 9}
        strokeDasharray={`${(circumference * (rows[0]?.value || 0)) / denominator} ${circumference}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />,
    );
    text(cx, cy + 4, `${rows[0]?.value || 0} / ${denominator}`, 'middle');
    rows.forEach((d, i) => {
      text(cx + r + 16, cy - 12 + i * 26, `${d.label} ${d.value}${small ? '' : ' 项'}`);
    });
    if (spacious) text(0, height - 4, '名单与培训时段仍待确认', 'start', muted);
  } else if (chart.kind === 'timeline') {
    const left = 10,
      right = width - 10,
      values = rows.map((d) => d.value),
      min = Math.min(...values),
      span = Math.max(...values) - min || 1,
      y = height / 2;
    line(left, y, right, y, gray, 2);
    rows.forEach((d, i) => {
      const x = left + ((d.value - min) / span) * (right - left),
        anchor = i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle';
      dot(x, y, 4);
      text(x, y - 18, small ? d.label.slice(-2) : d.label, anchor);
      text(x, y + 24, new Date(d.value).toISOString().slice(5, 10).replace('-', '/'), anchor, muted);
    });
  } else if (chart.kind === 'heatmap') {
    const left = small ? 65 : 84,
      cols = chart.columns || [],
      cellWidth = (width - left) / Math.max(cols.length, 1),
      cellHeight = spacious ? 29 : 14,
      top = 19;
    cols.forEach((c, i) => text(left + (i + 0.5) * cellWidth, 11, c, 'middle', muted));
    rows.forEach((r, i) => {
      const y = top + i * (cellHeight + 5);
      text(0, y + cellHeight / 2 + 4, r.label);
      cols.forEach((_, j) => {
        const value = chart.matrix?.[i]?.[j] ?? 0;
        rect(
          left + j * cellWidth + 2,
          y,
          cellWidth - 4,
          cellHeight,
          ['#f2e9d9', '#e1e9f6', '#437bd4'][value],
          3,
        );
        text(
          left + (j + 0.5) * cellWidth,
          y + cellHeight / 2 + 4,
          ['补', '待', '齐'][value],
          'middle',
          value === 2 ? '#fff' : ink,
        );
      });
    });
    if (spacious) text(0, height - 8, '补：待补充 · 待：待确认 · 齐：齐备', 'start', muted);
  } else if (chart.kind === 'waterfall') {
    let running = 0;
    const bars = rows.map((d, i) => {
      if (i === 0 || i === rows.length - 1) {
        running = d.value;
        return { start: 0, end: d.value };
      }
      const start = running;
      running += d.value;
      return { start, end: running };
    });
    const min = Math.min(0, ...bars.flatMap((b) => [b.start, b.end])),
      max = Math.max(1, ...bars.flatMap((b) => [b.start, b.end])),
      top = 21,
      bottom = height - 24;
    const y = (v: number) => bottom - ((v - min) / (max - min)) * (bottom - top),
      pitch = width / rows.length,
      bw = Math.min(40, pitch * 0.62);
    line(0, y(0), width, y(0));
    rows.forEach((d, i) => {
      const x = i * pitch + (pitch - bw) / 2,
        b = bars[i];
      rect(
        x,
        y(Math.max(b.start, b.end)),
        bw,
        Math.abs(y(b.start) - y(b.end)),
        i === 0 || i === rows.length - 1 ? blue : d.value > 0 ? light : amber,
        2,
      );
      text(
        x + bw / 2,
        y(Math.max(b.start, b.end)) - 7,
        `${i > 0 && i < rows.length - 1 && d.value > 0 ? '+' : ''}${number(d.value)}`,
        'middle',
      );
      text(x + bw / 2, height - 4, small ? d.label.slice(0, 2) : d.label, 'middle', muted);
      if (i < rows.length - 1) line(x + bw, y(b.end), (i + 1) * pitch + (pitch - bw) / 2, y(b.end), gray);
    });
  } else if (chart.kind === 'multiples') {
    const series = chart.series || [],
      left = small ? 56 : 85,
      right = width - 16,
      top = 4,
      rowHeight = (height - 22) / Math.max(series.length, 1),
      max = Math.max(1, ...series.flatMap((s) => s.values));
    series.forEach((s, i) => {
      const bottom = top + (i + 1) * rowHeight - 4,
        x = (j: number) => left + (j * (right - left)) / Math.max(s.values.length - 1, 1),
        y = (v: number) => bottom - (v / max) * (rowHeight - 8);
      text(0, top + (i + 0.5) * rowHeight + 4, s.label);
      line(left, bottom, right, bottom);
      marks.push(
        <polyline
          key={seq++}
          points={s.values.map((v, j) => `${x(j)},${y(v)}`).join(' ')}
          fill="none"
          stroke={blue}
          strokeWidth="2"
        />,
      );
      s.values.forEach((v, j) => dot(x(j), y(v), 2.5));
      text(right + 8, y(s.values.at(-1) || 0) + 4, number(s.values.at(-1) || 0));
    });
    const cols = chart.columns || [];
    cols.forEach((c, i) =>
      text(
        left + (i * (right - left)) / Math.max(cols.length - 1, 1),
        height - 3,
        c,
        i === 0 ? 'start' : i === cols.length - 1 ? 'end' : 'middle',
        muted,
      ),
    );
  }
  return (
    <div ref={ref} className="briefing-visual-chart" data-chart-kind={chart.kind}>
      <div className="briefing-chart-period">
        {briefingPeriod(chart.period)}
        {!['timeline', 'heatmap'].includes(chart.kind) && <span>{chart.unit}</span>}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ height }}
        role="img"
        aria-label={chartDescription(chart)}
      >
        {marks}
      </svg>
    </div>
  );
}
