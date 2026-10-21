import type { BriefingPresentation } from '../../contracts/public-api/briefing-content';

// Compatibility for archived prose only. New generation supplies structured roles.
const legacyRoles = { 经营信号: 'OBSERVATION', 待验证判断: 'INTERPRETATION', 最小行动: 'ACTION', 验证边界: 'CAUTION' } as const;
export function readingGroups(analysis: string[], sections: BriefingPresentation['sections'] = []) {
  const result = { facts: [] as string[], judgments: [] as string[], actions: [] as string[], cautions: [] as string[], structured: false };
  analysis.forEach((original, index) => {
    const prefix = original.match(/^(经营信号|待验证判断|最小行动|验证边界)[：:]/);
    const role = sections.find(s => s.paragraphIndex === index)?.role ?? (prefix ? legacyRoles[prefix[1] as keyof typeof legacyRoles] : undefined);
    result.structured ||= role !== undefined;
    const text = prefix ? original.slice(prefix[0].length) : original;
    const target = role === 'INTERPRETATION' ? result.judgments : role === 'ACTION' || role === 'OPTION' ? result.actions : role === 'CAUTION' ? result.cautions : result.facts;
    target.push(text);
  });
  return result;
}
