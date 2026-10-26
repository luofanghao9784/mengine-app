/** Platform support uses its own cookie/CSRF and a tenant-bound server context. */
export function supportRoute() {
  if (
    typeof location === 'undefined' ||
    !(location.pathname.startsWith('/platform-admin/') || location.pathname === '/tenant-admin/support/')
  )
    return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get('support'),
    tenant = params.get('tenant');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return id && tenant && uuid.test(id) && uuid.test(tenant) ? { id, tenant } : null;
}
export function supportPath(path: string) {
  const access = supportRoute();
  return access && /^\/api\/(v1|tenant-admin\/v1)\/tenants\//.test(path)
    ? `/api/platform-admin/v1/support-access/${access.id}${path}`
    : path;
}

/** Support context wins over optional customer query parameters. */
export function sceneTenant() {
  return supportRoute()?.tenant ?? new URLSearchParams(location.search).get('tenant');
}
