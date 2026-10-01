import type { BriefingCard, CardData } from './briefing.ts';

// Insights use the dated-content rule provisionally. Conversation records remain
// live but are currently excluded from the magazine surface.
export function briefingLifecycle(data: CardData): 'live' | 'dated' | 'conversation' {
  if (data.sourceKind === 'conversation' || data.template === 'conversation') return 'conversation';
  return data.type === '经营数据' || data.type === '项目进展' ? 'live' : 'dated';
}

export function briefingCreatedAt(card: BriefingCard) {
  // A legacy dated card may already contain a later revision. Keep that current
  // content with its actual retained time, never relabel later facts as earlier.
  return (
    card.createdAt ||
    (briefingLifecycle(card.data) === 'dated'
      ? card.updatedAt
      : card.history[0]?.at || card.data.authoredAt || card.updatedAt)
  );
}

export function briefingEntry(card: BriefingCard, day?: string) {
  const dated = briefingLifecycle(card.data) === 'dated';
  const at = dated ? briefingCreatedAt(card) : card.updatedAt;
  if (day !== undefined && (!dated || (day && new Date(at).toLocaleDateString('sv-SE') !== day)))
    return undefined;
  return { card, data: card.data, at };
}
