/** Exact decimal presentation only; immutable calculation receipts keep their original unit. */
export function displayAmount(raw: string | null, unit: string): string | null {
  if (raw === null || unit !== '分') return raw;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return raw;
  const digits = match[2].padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/^0+(?=\d)/, '');
  const fraction = (digits.slice(-2) + (match[3] ?? '')).replace(/0+$/, '');
  const sign = /^0+$/.test(whole) && !fraction ? '' : match[1];
  return sign + whole + (fraction ? '.' + fraction : '');
}
