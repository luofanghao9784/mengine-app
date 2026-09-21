import type { DemoState } from './model.ts';
import { createKongguSeed } from './kongguSeed.ts';
import { KONGGU_STORAGE_KEY } from './kongguSources.ts';
import { syncBriefing } from './briefing.ts';

export function loadKongguState(storage: Pick<Storage, 'getItem'>): DemoState {
  try {
    const stored = JSON.parse(storage.getItem(KONGGU_STORAGE_KEY) || 'null');
    if (
      stored?.schema === 1 &&
      stored.scenario === 'konggu' &&
      stored.profile &&
      stored.dream &&
      stored.dashboards &&
      ['spaces', 'materials', 'chats', 'records', 'apps', 'requests', 'activities', 'memories'].every((k) =>
        Array.isArray(stored[k]),
      )
    ) {
      return syncBriefing({
        ...stored,
        folders: stored.folders || [],
        collaborations: stored.collaborations || [],
      });
    }
  } catch {
    /* A corrupt cafe fixture never mutates the earlier generic demo storage. */
  }
  return syncBriefing(createKongguSeed());
}
