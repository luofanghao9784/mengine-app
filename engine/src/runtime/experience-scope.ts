/** Internal processing identity, never an authorization grant or a customer-selected mode.
 * Existing tenant jobs retain their exact wire shape. Platform jobs explicitly carry no tenant.
 */
export type ExperienceScope = { tenant: string; scope?: never } | { tenant: null; scope: 'PLATFORM' };

export function validExperienceScope(job: Record<string, unknown>): boolean {
  return Object.hasOwn(job, 'scope')
    ? job.scope === 'PLATFORM' && job.tenant === null
    : typeof job.tenant === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(job.tenant);
}
