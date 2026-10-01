import type { DemoState } from '../model.ts';
import { syncBriefing } from '../briefing.ts';
import { NINEPOP_STORAGE_KEY } from './adapter.ts';

export function loadNinepopSession(seed: DemoState, storage: Pick<Storage, 'getItem'>): DemoState {
  const next = structuredClone(seed);
  try {
    const cached = JSON.parse(storage.getItem(NINEPOP_STORAGE_KEY) || 'null');
    if (
      cached?.schema === 1 &&
      cached.scenario === 'ninepop' &&
      cached.ninepop?.datasetId === seed.ninepop?.datasetId
    ) {
      if (Array.isArray(cached.chats)) next.chats = cached.chats;
      if (cached.briefing?.version === 1 && Array.isArray(cached.briefing.cards))
        next.briefing = cached.briefing;
      if (cached.profile?.compact === true) next.profile.compact = true;
    }
  } catch {
    /* Corrupt or unrelated state never replaces the server-provided package. */
  }
  // Refresh the reviewed edition without discarding reading state or user layout choices.
  // Dated news normally stays immutable; this package is explicitly edited as one edition.
  for (const card of next.briefing?.cards || []) {
    const reviewed = seed.ninepop?.cards.find((data) => data.id === card.id);
    if (!reviewed) continue;
    if (card.config?.title === card.data.title) card.config.title = reviewed.title;
    card.data = structuredClone(reviewed);
  }
  return syncBriefing(next);
}
