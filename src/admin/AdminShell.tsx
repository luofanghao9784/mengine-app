import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  Archive,
  BookOpen,
  Building2,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  SlidersHorizontal,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { PageActionsContext, Button } from '../shared/ui';
import { RequestPending, requestNavigationLocked } from '../shared/request-guard';
import { adminHref, adminPage, type AdminPage, type AdminRealm } from './navigation';
import './admin.css';
import { DreamcoreLogo } from '../components/DreamcoreLogo';

const entries: Record<AdminRealm, { id: AdminPage; title: string; icon: LucideIcon }[]> = {
  tenant: [
    { id: 'overview', title: '概览', icon: LayoutDashboard },
    { id: 'engine', title: '引擎运行', icon: Activity },
    { id: 'members', title: '成员与空间', icon: Users },
    { id: 'database', title: '数据库', icon: Database },
    { id: 'materials', title: '资料库', icon: Archive },
    { id: 'experience', title: '经验库', icon: BookOpen },
    { id: 'company', title: '企业信息', icon: Building2 },
  ],
  platform: [
    { id: 'overview', title: '概览', icon: LayoutDashboard },
    { id: 'tenants', title: '企业管理', icon: Building2 },
    { id: 'accounts', title: '账号管理', icon: Users },
    { id: 'engine', title: '系统运行', icon: Activity },
    { id: 'experience', title: '经验库', icon: BookOpen },
    { id: 'capabilities', title: '引擎管理', icon: SlidersHorizontal },
    { id: 'usage', title: '用量与成本', icon: Wallet },
  ],
};
export function useAdminRoute(realm: AdminRealm) {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const changed = () => {
      if (!requestNavigationLocked()) setHash(location.hash);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return { hash, page: adminPage(realm, hash) };
}
export function AdminShell({
  realm,
  name,
  account,
  page,
  hash,
  logout,
  customerLinks,
  children,
}: {
  realm: AdminRealm;
  name: string;
  account: string;
  page: AdminPage;
  hash: string;
  logout: () => void;
  customerLinks?: ReactNode;
  children: ReactNode;
}) {
  const pending = useContext(RequestPending);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const main = useRef<HTMLElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const nav = entries[realm];
  const title = page === 'settings' ? '设置' : nav.find((x) => x.id === page)?.title || '概览';
  useLayoutEffect(() => {
    document.title = `${title} · ${realm === 'platform' ? '梦擎总台' : name + '企业管理'}`;
    setMobileOpen(false);
    const element = main.current;
    if (!element) return;
    const saved = scrollPositions.current.get(hash) || 0;
    let waiting = saved > 0;
    const restore = () => {
      if (!waiting) return;
      element.scrollTop = saved;
      if (element.scrollHeight - element.clientHeight >= saved) waiting = false;
    };
    element.scrollTop = saved;
    const observer = new MutationObserver(restore);
    observer.observe(element, { childList: true, subtree: true });
    const manual = () => {
      waiting = false;
    };
    element.addEventListener('wheel', manual, { passive: true });
    element.addEventListener('touchstart', manual, { passive: true });
    element.addEventListener('keydown', manual);
    restore();
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', manual);
      element.removeEventListener('touchstart', manual);
      element.removeEventListener('keydown', manual);
      scrollPositions.current.set(hash, waiting ? saved : element.scrollTop);
    };
  }, [hash, title, name, realm]);
  return (
    <PageActionsContext.Provider value={actions}>
      <div className={`admin-shell ${mobileOpen ? 'admin-menu-open' : ''}`}>
        {mobileOpen && (
          <button className="admin-scrim" aria-label="关闭导航" onClick={() => setMobileOpen(false)} />
        )}
        <aside className="admin-sidebar" aria-label={realm === 'platform' ? '总台导航' : '企业管理导航'}>
          <div className="admin-brand">
            <DreamcoreLogo />
            <div>
              <strong>梦擎</strong>
              <small>{realm === 'platform' ? '平台总台' : '企业管理'}</small>
            </div>
            <Button
              className="admin-close-menu"
              icon={X}
              variant="ghost"
              aria-label="关闭导航"
              onClick={() => setMobileOpen(false)}
            />
          </div>
          <div className="admin-scope" title={name}>
            {name}
          </div>
          <nav>
            {nav.map(({ id, title, icon: Icon }) => (
              <a
                key={id}
                className={`admin-nav-link ${page === id ? 'active' : ''}`}
                aria-current={page === id ? 'page' : undefined}
                href={adminHref(realm, id, hash)}
                onClick={(e) => {
                  if (pending) e.preventDefault();
                }}
              >
                <Icon size={20} aria-hidden="true" />
                <span>{title}</span>
              </a>
            ))}
          </nav>
          <div className="admin-sidebar-footer">
            {realm === 'platform' && (
              <a
                className={`admin-nav-link ${page === 'settings' ? 'active' : ''}`}
                aria-current={page === 'settings' ? 'page' : undefined}
                href={adminHref(realm, 'settings', hash)}
                onClick={(e) => {
                  if (pending) e.preventDefault();
                }}
              >
                <Settings size={20} aria-hidden="true" />
                设置
              </a>
            )}
            {realm === 'tenant' && customerLinks && (
              <div className="admin-customer-links">{customerLinks}</div>
            )}
            <div className="admin-account">
              <span title={account}>{account}</span>
              <Button
                variant="ghost"
                icon={LogOut}
                disabled={pending}
                onClick={logout}
                aria-label={realm === 'platform' ? '退出总台' : '退出登录'}
              />
            </div>
          </div>
        </aside>
        <div className="admin-main">
          <header className="admin-header">
            <div className="admin-heading">
              <Button
                className="admin-open-menu"
                icon={Menu}
                variant="ghost"
                aria-label="展开导航"
                onClick={() => setMobileOpen(true)}
              />
              <div>
                <span className="admin-breadcrumb">{realm === 'platform' ? '平台总台' : name}</span>
                <h1>{title}</h1>
              </div>
            </div>
            <div className="admin-page-actions" ref={setActions} />
          </header>
          <main className="admin-content" ref={main}>
            {pending && (
              <p role="status" className="access-alert">
                正在核对本次提交，请在当前页面完成后再切换。
              </p>
            )}
            {children}
          </main>
        </div>
      </div>
    </PageActionsContext.Provider>
  );
}
