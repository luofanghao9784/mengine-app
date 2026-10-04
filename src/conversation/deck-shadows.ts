type ShadowCard = { id: string; left: number; right: number; order: number };

/** Keep broad surrounding shadows on at most two cards per overlap group.
 * Intermediate cards use compact contact shadows to show each folded edge. */
export function mutedDeckShadowIds(cards: ShadowCard[]): Set<string> {
  const muted = new Set<string>();
  const ordered = [...cards].filter((card) => card.right > card.left).sort((a, b) => a.left - b.left);
  let group: ShadowCard[] = [];
  let edge = -Infinity;
  const finish = () => {
    const layers = [...group].sort((a, b) => a.order - b.order);
    for (const card of layers.slice(1, -1)) muted.add(card.id);
  };
  for (const card of ordered) {
    if (card.left >= edge - 1) {
      finish();
      group = [];
      edge = -Infinity;
    }
    group.push(card);
    edge = Math.max(edge, card.right);
  }
  finish();
  return muted;
}
