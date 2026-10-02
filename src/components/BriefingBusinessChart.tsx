import type { ReactNode } from 'react';
import type { BriefingChart } from '../briefingPresentation';

const blue = '#356cd4',
  pale = '#bed0ee',
  ink = '#23334b',
  muted = '#617087';
const green = '#308777',
  amber = '#bc773b',
  grid = '#e8edf4';
const palette = [blue, '#479a98', '#8a9fd0', '#d5a565', '#a5b4c2'];
const amount = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const percent = (value: number, total: number) =>
  total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '—';
export const isBusinessChart = (chart: BriefingChart) =>
  ['columns', 'diverging', 'bars', 'donut', 'funnel', 'unit-grid', 'progress'].includes(chart.kind);

export function businessChartHeight(chart: BriefingChart, width: number): number {
  switch (chart.kind) {
    case 'columns':
      return 230;
    case 'diverging':
      return 30 + chart.rows.length * 38;
    case 'bars':
      return 16 + chart.rows.length * 43;
    case 'donut':
      return width >= 430 ? 200 : 165 + chart.rows.length * 25;
    case 'funnel':
      return 145 + (chart.series?.length || 0) * 23;
    case 'unit-grid':
      return 122;
    case 'progress':
      return chart.rows.length * 72;
    default:
      return 60;
  }
}

/** Each graphic encodes one business question; all numeric labels retain source units. */
export function BriefingBusinessChart({
  chart,
  width,
  height,
}: {
  chart: BriefingChart;
  width: number;
  height: number;
}) {
  const marks: ReactNode[] = [];
  const rows = chart.rows;
  let key = 0;
  const text = (
    x: number,
    y: number,
    value: ReactNode,
    anchor: 'start' | 'middle' | 'end' = 'start',
    color = ink,
    size = 12,
    weight = 400,
  ) =>
    marks.push(
      <text
        key={key++}
        x={x}
        y={y}
        textAnchor={anchor}
        fill={color}
        style={{ fontSize: size, fontWeight: weight }}
      >
        {value}
      </text>,
    );
  const rect = (x: number, y: number, w: number, h: number, fill: string, title?: string) =>
    marks.push(
      <rect key={key++} x={x} y={y} width={Math.max(0, w)} height={Math.max(0, h)} rx={3} fill={fill}>
        {title && <title>{title}</title>}
      </rect>,
    );
  const line = (x1: number, y1: number, x2: number, y2: number, stroke = grid) =>
    marks.push(<line key={key++} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} />);
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  if (chart.kind === 'columns') {
    const left = 34,
      bottom = height - 39,
      top = 44,
      pitch = (width - left) / Math.max(rows.length, 1);
    const values = rows.flatMap((row) => [
      row.valueMissing ? 0 : row.value,
      row.previousMissing ? 0 : row.previous || 0,
    ]);
    const peak = Math.max(1, ...values.map(Math.abs));
    const step = 10 ** Math.floor(Math.log10(peak));
    const max = Math.ceil(Math.max(1, ...values) / step) * step;
    const min = Math.floor(Math.min(0, ...values) / step) * step;
    const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top);
    const legendWidth = Math.min(
      (width - left) / 2,
      Math.max(68, (chart.columns?.[0]?.length || 2) * 7 + 28),
    );
    const legend = (label: string, room: number) =>
      label.length * 7 > room ? label.slice(0, Math.max(2, Math.floor(room / 7) - 1)) + '…' : label;
    rect(left, 2, 10, 10, pale);
    text(
      left + 16,
      12,
      <tspan>
        <title>{chart.columns?.[0] || '上期'}</title>
        {legend(chart.columns?.[0] || '上期', legendWidth - 20)}
      </tspan>,
      'start',
      muted,
    );
    rect(left + legendWidth, 2, 10, 10, blue);
    text(
      left + legendWidth + 16,
      12,
      <tspan>
        <title>{chart.columns?.[1] || '本期'}</title>
        {legend(chart.columns?.[1] || '本期', width - left - legendWidth - 16)}
      </tspan>,
      'start',
      muted,
    );
    for (const value of min < 0 ? [min, 0, max] : [0, max / 2, max]) {
      line(left, y(value), width, y(value));
      text(
        left - 6,
        y(value) + 4,
        value >= 10000 ? `${amount(value / 10000)}万` : amount(value),
        'end',
        muted,
        10,
      );
    }
    rows.forEach((row, i) => {
      const x = left + (i + 0.5) * pitch,
        bar = Math.min(25, pitch * 0.3);
      if (!row.previousMissing)
        rect(
          x - bar - 1.5,
          Math.min(y(0), y(row.previous || 0)),
          bar,
          Math.abs(y(0) - y(row.previous || 0)),
          pale,
          `${row.label} · ${chart.columns?.[0]}：${row.previousText ?? amount(row.previous || 0)}${chart.unit}`,
        );
      if (!row.valueMissing)
        rect(
          x + 1.5,
          Math.min(y(0), y(row.value)),
          bar,
          Math.abs(y(0) - y(row.value)),
          blue,
          `${row.label} · ${chart.columns?.[1]}：${row.valueText ?? amount(row.value)}${chart.unit}`,
        );
      // Label the current bar directly; exact prior values remain available on the light bar.
      marks.push(
        <text
          key={key++}
          x={Math.min(width - 22, x + 1.5 + bar / 2)}
          y={y(Math.max(0, row.value)) - 9}
          textAnchor="middle"
          fill={blue}
          stroke="white"
          strokeWidth={3}
          paintOrder="stroke"
          style={{ fontSize: 11, fontWeight: 600 }}
        >
          <title>{row.valueMissing ? '缺数据' : (row.valueText ?? amount(row.value))}</title>
          {row.valueMissing
            ? '缺数据'
            : (row.valueText?.length || 0) > 12
              ? row.value.toExponential(2)
              : (row.valueText ?? amount(row.value))}
        </text>,
      );
      const label = row.label.replace(/店$/, '');
      const maximum = Math.max(4, Math.floor(pitch / 11) * 2);
      const visibleLabel = label.length > maximum ? label.slice(0, maximum - 1) + '…' : label;
      const wrap = visibleLabel.length * 11 > pitch - 4;
      const split = Math.ceil(visibleLabel.length / 2);
      const chunks = wrap ? [visibleLabel.slice(0, split), visibleLabel.slice(split)] : [visibleLabel];
      text(
        x,
        bottom + 18,
        chunks.map((part, j) => (
          <tspan key={j} x={x} dy={j ? 14 : 0}>
            <title>{row.label}</title>
            {part}
          </tspan>
        )),
        'middle',
        muted,
        11,
      );
    });
  } else if (chart.kind === 'diverging') {
    const left = Math.min(78, width * 0.3),
      right = width - 34,
      zero = (left + right) / 2;
    const max = Math.max(1, ...rows.map((row) => Math.abs(row.value - (row.previous || 0))));
    const scale = (right - left) / 2 / max;
    const pitch = (height - 26) / Math.max(rows.length, 1);
    text(left, 11, '减少', 'start', amber, 11);
    text(right, 11, '增加', 'end', green, 11);
    line(zero, 20, zero, height - 6, '#b7c4d4');
    rows.forEach((row, i) => {
      const delta = row.value - (row.previous || 0),
        y = 26 + i * pitch,
        length = Math.abs(delta) * scale;
      text(0, y + 15, row.label, 'start', ink, 11);
      rect(
        delta < 0 ? zero - length : zero,
        y + 2,
        length,
        22,
        delta < 0 ? amber : green,
        `${row.label}：${row.previous} → ${row.value}${chart.unit}`,
      );
      text(width, y + 17, `${delta > 0 ? '+' : ''}${delta}`, 'end', delta < 0 ? amber : green, 12, 600);
    });
  } else if (chart.kind === 'bars') {
    const pitch = height / Math.max(rows.length, 1),
      max = Math.max(1, ...rows.map((row) => row.value));
    rows.forEach((row, i) => {
      const y = i * pitch;
      text(0, y + 13, row.label);
      text(width, y + 13, amount(row.value), 'end', ink, 12, 600);
      rect(0, y + 23, width, 14, '#edf2f8');
      rect(0, y + 23, (row.value / max) * width, 14, i === 0 ? blue : '#91b1e7');
    });
  } else if (chart.kind === 'donut') {
    const wide = width >= 430,
      radius = wide ? 62 : 55;
    const legendHeight = rows.length * 25;
    const cx = wide ? 82 : width / 2;
    const cy = wide ? height / 2 : Math.max(72, (height - legendHeight - 20) / 2);
    const circumference = 2 * Math.PI * radius;
    marks.push(<circle key={key++} cx={cx} cy={cy} r={radius} fill="none" stroke={grid} strokeWidth={18} />);
    let offset = 0;
    rows.forEach((row, i) => {
      const arc = total > 0 ? (circumference * row.value) / total : 0;
      marks.push(
        <circle
          key={key++}
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={palette[i % palette.length]}
          strokeWidth={18}
          strokeDasharray={`${arc} ${Math.max(0, circumference - arc)}`}
          strokeDashoffset={-offset}
          transform={`rotate(-90 ${cx} ${cy})`}
        >
          <title>{`${row.label}：${amount(row.value)}${chart.unit}，占${percent(row.value, total)}`}</title>
        </circle>,
      );
      offset += arc;
    });
    text(cx, cy - 8, '合计', 'middle', muted, 11);
    text(
      cx,
      cy + 17,
      total >= 10000 ? `${(total / 10000).toFixed(2)}万` : amount(total),
      'middle',
      ink,
      19,
      600,
    );
    const left = wide ? 180 : 0,
      top = wide ? (height - legendHeight) / 2 : height - legendHeight;
    rows.forEach((row, i) => {
      const y = top + i * 25 + 16;
      rect(left, y - 9, 8, 8, palette[i % palette.length]);
      text(left + 15, y, row.label, 'start', ink, 11);
      text(width, y, amount(row.value), 'end', ink, 11);
    });
  } else if (chart.kind === 'funnel') {
    const initial = rows[0]?.value || 0,
      converted = rows[1]?.value || 0;
    const left = 0,
      topWidth = width,
      nextWidth = initial > 0 ? (width * converted) / initial : 0;
    text(0, 13, rows[0]?.label || '起点');
    text(width, 13, `${amount(initial)} ${chart.unit}`, 'end', ink, 13, 600);
    rect(left, 22, topWidth, 20, pale);
    marks.push(
      <polygon
        key={key++}
        points={`0,42 ${width},42 ${(width + nextWidth) / 2},76 ${(width - nextWidth) / 2},76`}
        fill="#edf2fa"
      />,
    );
    rect((width - nextWidth) / 2, 76, nextWidth, 20, blue);
    text(0, 115, rows[1]?.label || '完成');
    text(
      width,
      115,
      `${amount(converted)} ${chart.unit} · ${percent(converted, initial)}`,
      'end',
      blue,
      13,
      600,
    );
    const series = chart.series || [];
    if (series.length) {
      const start = 140,
        pitch = Math.max(23, (height - start) / series.length);
      text(width * 0.57, start, '体验', 'end', muted, 10);
      text(width * 0.76, start, '购课', 'end', muted, 10);
      text(width, start, '转正率', 'end', muted, 10);
      series.forEach((store, i) => {
        const y = start + 20 + i * pitch;
        text(0, y, store.label, 'start', ink, 11);
        text(width * 0.57, y, store.values[0], 'end', muted, 11);
        text(width * 0.76, y, store.values[1], 'end', blue, 11, 600);
        text(width, y, percent(store.values[1], store.values[0]), 'end', muted, 11);
      });
    }
  } else if (chart.kind === 'unit-grid') {
    const count = Math.max(0, Math.round(total)),
      columns = Math.min(height >= 220 ? 5 : 10, Math.max(count, 1));
    const gridRows = Math.ceil(count / columns);
    const size = Math.min(
      38,
      (height - 65) / Math.max(gridRows, 1) - 5,
      (width - (columns - 1) * 5) / columns,
    );
    const top = Math.max(2, (height - gridRows * (size + 5) - 60) / 2);
    const origin = (width - columns * size - (columns - 1) * 5) / 2;
    let index = 0;
    rows.forEach((row, group) => {
      for (let cell = 0; cell < row.value; cell++, index++)
        rect(
          origin + (index % columns) * (size + 5),
          Math.floor(index / columns) * (size + 5) + top,
          size,
          size,
          group === 0 ? blue : '#dce6f5',
          `${row.label} · ${cell + 1}${chart.unit}`,
        );
    });
    const y = top + gridRows * (size + 5) + 16;
    rows.forEach((row, i) => {
      rect(0, y + i * 23 - 9, 8, 8, i === 0 ? blue : '#dce6f5');
      text(15, y + i * 23, row.label, 'start', muted, 11);
      text(width, y + i * 23, `${row.value} ${chart.unit}`, 'end', ink, 12, 600);
    });
  } else if (chart.kind === 'progress') {
    const pitch = height / Math.max(rows.length, 1);
    rows.forEach((row, i) => {
      const y = i * pitch,
        contract = row.previous || 0,
        share = contract > 0 ? Math.min(1, row.value / contract) : 0;
      text(0, y + 14, row.label);
      text(width, y + 14, percent(row.value, contract), 'end', blue, 15, 600);
      rect(0, y + 26, width, 18, '#e6edf7');
      rect(0, y + 26, width * share, 18, blue);
      text(0, y + 62, `已收 ${amount(row.value)}`, 'start', muted, 11);
      text(width, y + 62, `待收 ${amount(Math.max(0, contract - row.value))}`, 'end', muted, 11);
    });
  }
  return <g data-business-chart={chart.kind}>{marks}</g>;
}
