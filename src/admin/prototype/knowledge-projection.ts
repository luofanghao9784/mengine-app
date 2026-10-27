/** Only the server may admit processed source content as published knowledge. */
export function knowledgeProjection<T extends { items: unknown[]; tabs: { label: string; items: unknown[] }[] }>(snapshot: T): T {
  return snapshot.tabs.length ? snapshot : { ...snapshot, tabs: [{ label: `全部 ${snapshot.items.length}`, items: snapshot.items }] };
}
