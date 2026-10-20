export function TenantScene({
  tenant,
  name,
}: {
  tenant: string;
  name: string;
}) {
  return (
    <main
      style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#171a1b' }}
    >
      <iframe
        key={tenant}
        title={`${name} · 数据基座场景`}
        src={`/tenant-admin/prototype/?tenant=${encodeURIComponent(tenant)}`}
        style={{ border: 0, width: '100%', flex: 1, minHeight: 0 }}
      />
    </main>
  );
}
