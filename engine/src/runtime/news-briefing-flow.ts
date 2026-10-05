import { contextResponse } from './task-context.js';
import type { Json } from './ports.js';

/** Bounded, server-authorized summaries for topic choice, never external search text. */
export async function newsBriefingBackground(
  invoke: (action: string, body: unknown, limit?: number) => Promise<unknown>,
): Promise<Json[]> {
  const results: Json[] = [];
  for (const scope of ['TENANT', 'WORKSPACE', 'PERSONAL'])
    results.push(contextResponse(await invoke('context', { action: 'profiles', scope }, 32768), 'profiles'));
  return results;
}

/** Leave the eight-call budget for search, original evidence, editorial selection and delivery. */
export function newsBriefingToolAllowed(name: string, searched: boolean, read: boolean): boolean {
  if (name === 'task_control') return true;
  if (!searched) return name === 'public_search';
  if (!read) return name === 'read_public_page';
  return ['read_public_page', 'select_briefing_topic', 'deliver_briefing'].includes(name);
}
