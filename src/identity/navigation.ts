import { uuid } from './client.ts';

const views = new Set([
  'briefing',
  'conversations',
  'library',
  'documents',
  'plans',
  'profiles',
  'spaces',
  'departure',
]);
const references = [
  'conversation',
  'task',
  'folder',
  'document',
  'plan',
  'source',
  'space',
  'briefingTask',
  'briefingSpace',
];

/** Only navigation references cross surfaces; never accept an arbitrary URL or user text. */
export function workspaceReturnHash(hash: string, tenant: string): string | undefined {
  const input = new URLSearchParams(hash.replace(/^#/, ''));
  if (!uuid(tenant) || input.get('tenant') !== tenant) return;
  const view = input.get('view') || 'briefing';
  if (!views.has(view)) return;
  const output = new URLSearchParams({ tenant, view });
  for (const key of references) if (uuid(input.get(key))) output.set(key, input.get(key)!);
  const scope = input.get('scope');
  if (scope && (uuid(scope) || ['personal', 'enterprise', 'all'].includes(scope))) output.set('scope', scope);
  for (const key of ['version', 'briefingRevision', 'briefingAttempt']) {
    const value = input.get(key);
    if (value && /^\d{1,9}$/.test(value)) output.set(key, value);
  }
  if (input.get('from') === 'briefing') output.set('from', 'briefing');
  return '#' + output;
}

export function managementHref(surface: 'tenant-admin' | 'platform-admin', tenant: string, current: string) {
  const params = new URLSearchParams({ tenant });
  const back = workspaceReturnHash(current, tenant);
  if (back) params.set('back', back);
  if (surface === 'tenant-admin') {
    const context = new URLSearchParams(current.replace(/^#/, ''));
    if (context.get('view') === 'library' && uuid(context.get('scope'))) {
      params.set('manage', 'sources');
      params.set('scope', context.get('scope')!);
      if (uuid(context.get('source'))) params.set('source', context.get('source')!);
    } else if (context.get('view') === 'spaces') {
      params.set('manage', 'business');
      params.set('tab', 'spaces');
      if (uuid(context.get('space'))) params.set('space', context.get('space')!);
    }
  }
  return `/${surface}/#${params}`;
}

export function returnToWorkspaceHref(hash: string, tenant: string) {
  const back = new URLSearchParams(hash.replace(/^#/, '')).get('back');
  return (
    '/workspace/' +
    ((back && workspaceReturnHash(back, tenant)) || '#' + new URLSearchParams({ tenant, view: 'briefing' }))
  );
}
