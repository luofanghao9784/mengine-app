/** Display-only formatting; never write presentation dates back to content or snapshots. */
export function briefingTime(at: string, full = false, now = new Date()): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return '时间待核实';
  const year = date.getFullYear();
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (full) return `${year}年${monthDay} ${clock}`;
  const today = date.toDateString() === now.toDateString();
  return `${today ? '今天' : `${year === now.getFullYear() ? '' : `${year}年`}${monthDay}`} ${clock}`;
}

export function briefingSource(source: string): string {
  return source
    .replace(/原文 (\d{4})-(\d{2})-(\d{2})/g, (_, y, m, d) => `发布于${y}年${Number(m)}月${Number(d)}日`)
    .replace(/(\d{2})-(\d{2})情境/g, (_, m, d) => `${Number(m)}月${Number(d)}日情境`);
}

/** Hide the legacy demo edition label on cards; retain the original source in detail and references. */
export function briefingCardSource(source: string): string {
  if (/^模拟底表\s+v\d+\s*·\s*(?:\d{2}-\d{2}|\d+月\d+日)情境$/.test(source.trim())) return '';
  return briefingSource(source);
}

export function briefingPeriod(period: string): string {
  const formatted = period.replace(/\b(\d{1,2})\/(\d{1,2})\b/g, (original, m, d) =>
    Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31
      ? `${Number(m)}月${Number(d)}日`
      : original,
  );
  return /^\d+月\d+日—\d+月\d+日/.test(formatted) ? `统计期：${formatted}` : formatted;
}
