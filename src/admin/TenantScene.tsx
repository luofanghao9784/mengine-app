export function TenantScene({
  tenant,
  name,
  enterprises,
  onChoose,
}: {
  tenant: string;
  name: string;
  enterprises: { id: string; name: string }[];
  onChoose: (id: string) => void;
}) {
  return (
    <main
      style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#171a1b' }}
    >
      <header
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          padding: '0 20px',
          background: '#f8f8f5',
          flexShrink: 0,
        }}
      >
        <strong>{name}</strong>
        <select aria-label="切换企业" value={tenant} onChange={(e) => onChoose(e.target.value)}>
          {enterprises.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <a href={`/workspace/#tenant=${encodeURIComponent(tenant)}`}>返回工作空间</a>
        <a href={`?view=business#tenant=${encodeURIComponent(tenant)}&admin=overview`}>全部管理功能</a>
        <span>企业数据输入 · 总台引擎处理</span>
      </header>
      <iframe
        key={tenant}
        title={`${name} · 数据基座场景`}
        src={`/tenant-admin/prototype/?tenant=${encodeURIComponent(tenant)}`}
        style={{ border: 0, width: '100%', flex: 1, minHeight: 0 }}
      />
    </main>
  );
}
