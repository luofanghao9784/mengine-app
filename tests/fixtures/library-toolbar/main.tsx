import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShieldCheck } from 'lucide-react';
import { AccountWorkspaces } from '../../../src/identity/AccountWorkspaces';
import { LibraryToolbar } from '../../../src/material/LibraryToolbar';
import { Modal } from '../../../src/shared/ui';
import { PageHeader } from '../../../src/shared/layout';
import { RequestPending } from '../../../src/shared/request-guard';
import '../../../src/shared/theme.css';
import '../../../src/identity/access.css';
import '../../../src/identity/workspace.css';
import '../../../src/material/material.css';
const memberships = [
  { tenantId: 'first', tenantName: '合成企业一', role: 'MEMBER' as const },
  { tenantId: 'second', tenantName: '合成企业二', role: 'MEMBER' as const },
];
function Fixture() {
  const [query, setQuery] = useState(''),
    [q, setQ] = useState(''),
    [layout, setLayout] = useState<'cards' | 'list'>('cards');
  const [account, setAccount] = useState(false),
    [tenant, setTenant] = useState('first'),
    [nested, setNested] = useState(false),
    [pending, setPending] = useState(false);
  return (
    <RequestPending.Provider value={pending}>
      <div className="access-shell workspace-shell">
        <aside className="access-sidebar">
          <button className="button" onClick={() => setNested(!nested)}>
            切换目录
          </button>
          <button className="access-avatar" onClick={() => setAccount(true)} aria-label="个人设置与账号">
            验
          </button>
        </aside>
        <div className="access-main">
          <PageHeader
            className="material-topbar"
            heading={<h1>资料库</h1>}
            actions={<button className="button">上传资料</button>}
          />
          <main className="access-content">
            <LibraryToolbar
              query={query}
              onQuery={setQuery}
              layout={layout}
              onLayout={setLayout}
              onSearch={() => setQ(query.trim())}
              onClear={() => {
                setQuery('');
                setQ('');
              }}
            >
              {nested && (
                <nav className="material-crumbs" aria-label="文件夹路径">
                  <button onClick={() => setNested(false)}>企业资料库</button>
                  <span> / 合成共享空间 / 子文件夹</span>
                </nav>
              )}
            </LibraryToolbar>
            <p>
              当前企业：{memberships.find((m) => m.tenantId === tenant)?.tenantName} · 搜索结果：{q || '全部'}{' '}
              · 视图：{layout}
            </p>
            <button className="button" onClick={() => setPending(!pending)}>
              模拟未完成提交
            </button>
            <div className="material-entries cards">
              {Array.from({ length: 24 }, (_, index) => (
                <article className="material-entry" key={index} style={{ height: 160, padding: 24 }}>
                  合成资料 {index + 1}
                </article>
              ))}
            </div>
          </main>
        </div>
        {account && (
          <Modal title="个人设置与账号" onClose={() => setAccount(false)}>
            <p>合成验收账号</p>
            <AccountWorkspaces
              tenant={tenant}
              memberships={memberships}
              links={[{ label: '切换到企业管理端', newTabLabel: '在新标签页打开企业管理端', href: '#management', icon: ShieldCheck }]}
              onChoose={(id) => {
                setTenant(id);
                setAccount(false);
              }}
              onNavigate={() => setAccount(false)}
            />
          </Modal>
        )}
      </div>
    </RequestPending.Provider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
