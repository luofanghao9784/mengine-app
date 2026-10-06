import type { BriefingDocument, BriefingPresentation } from '../../contracts/public-api/briefing-content';

export const sectionLabels = {
  OBSERVATION: '观察',
  INTERPRETATION: '解读',
  ACTION: '行动',
  OPTION: '方案',
  CAUTION: '需留意',
};

/** Validate stored composition as strictly as the delivery policy; legacy cards may omit it. */
export function isPresentation(
  value: unknown,
  content: Pick<BriefingDocument['content'], 'businessType' | 'analysis' | 'chart'>,
): value is BriefingPresentation {
  if (!value || typeof value !== 'object') return false;
  if (!Array.isArray(content.analysis)) return false;
  const p = value as BriefingPresentation;
  if (
    p.version !== 'briefing-presentation-v1' ||
    !['EDITORIAL', 'KEY_METRIC', 'STEPS', 'COMPARISON', 'SOURCE'].includes(p.layout)
  )
    return false;
  if (content.chart) {
    if (!['GROUPED_BAR', 'DUMBBELL', 'DELTA_BAR', 'CURRENT_BAR', 'TABLE'].includes(p.chartStyle!))
      return false;
    if (!['EDITORIAL', 'KEY_METRIC'].includes(p.layout)) return false;
  } else if (
    p.chartStyle != null ||
    p.focusGroup != null ||
    p.focusValue != null ||
    p.layout === 'KEY_METRIC'
  )
    return false;
  if (p.layout === 'STEPS' && content.businessType !== 'SUGGESTION') return false;
  if (p.layout === 'COMPARISON' && !['INSIGHT', 'SUGGESTION'].includes(content.businessType)) return false;
  if (
    p.focusGroup != null &&
    (typeof p.focusGroup !== 'string' ||
      p.focusGroup.length > 100 ||
      !Array.isArray(content.chart?.rows) ||
      !content.chart?.rows.some((r) => r.group === p.focusGroup))
  )
    return false;
  if (p.focusValue != null && !['CURRENT', 'DIFFERENCE', 'CHANGE_PERCENT'].includes(p.focusValue))
    return false;
  if (p.layout !== 'KEY_METRIC' && (p.focusGroup != null || p.focusValue != null)) return false;
  if (!Array.isArray(p.sections) || p.sections.length > 4) return false;
  const indices = new Set<number>();
  for (const section of p.sections) {
    if (
      !section ||
      !Object.hasOwn(sectionLabels, section.role) ||
      !Number.isInteger(section.paragraphIndex) ||
      section.paragraphIndex < 0 ||
      section.paragraphIndex >= content.analysis.length ||
      indices.has(section.paragraphIndex)
    )
      return false;
    indices.add(section.paragraphIndex);
  }
  if (['STEPS', 'COMPARISON'].includes(p.layout) && p.sections.length < 2) return false;
  if (p.layout === 'STEPS' && p.sections.some((s) => !['ACTION', 'CAUTION'].includes(s.role))) return false;
  if (p.layout === 'COMPARISON' && p.sections.filter((s) => s.role === 'OPTION').length < 2) return false;
  return true;
}

export function presentationOf(document: BriefingDocument): BriefingPresentation | null {
  const p = document.content.presentation;
  return p && isPresentation(p, document.content) ? p : null;
}

/** Exact decimal ordering, including amounts above JS's safe integer limit. */
export function compareDecimal(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  const scaled = (s: string) => {
    const negative = s.startsWith('-'),
      [whole, fraction = ''] = s.replace(/^-/, '').split('.');
    return BigInt(whole + fraction.padEnd(12, '0')) * (negative ? -1n : 1n);
  };
  const x = scaled(a),
    y = scaled(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
