import type { BriefingDocument } from '../../contracts/public-api/briefing-content';

// Explicit, user-approved relocation for an existing card. Do not infer that a
// paragraph is disposable merely because it mentions a limitation or evidence.
export const relocatedLegacyNote =
  '本任务计算回执只返回待核对记录的标识，未返回可可靠关联的会员或成交教练姓名，因此这里没有点名。责任分工来自已读企业背景；不能把郑西当作这3笔收款的成交教练。';

export function editorialEvidence(document: BriefingDocument) {
  const notes = document.content.analysis.filter((text) => text === relocatedLegacyNote);
  if (!notes.length) return { document, notes };
  const indices = new Map<number, number>();
  const analysis = document.content.analysis.filter((text, index) => {
    if (text === relocatedLegacyNote) return false;
    indices.set(index, indices.size);
    return true;
  });
  const presentation = document.content.presentation;
  return {
    notes: [...new Set(notes)],
    document: {
      ...document,
      content: {
        ...document.content,
        analysis,
        ...(presentation
          ? {
              presentation: {
                ...presentation,
                sections: presentation.sections
                  .filter((section) => indices.has(section.paragraphIndex))
                  .map((section) => ({ ...section, paragraphIndex: indices.get(section.paragraphIndex)! })),
              },
            }
          : {}),
      },
    },
  };
}
