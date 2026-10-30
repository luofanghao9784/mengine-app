import { CustomSelectContext } from '../shared/Select';
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  Archive,
  BookOpen,
  Building2,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SlidersHorizontal,
  Puzzle,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { PageActionsContext, PageTitleContext, Button } from '../shared/ui';
import { RequestPending, requestNavigationLocked } from '../shared/request-guard';
import { adminHref, adminPage, type AdminPage, type AdminRealm } from './navigation';
import { navigationTabTarget } from './navigation-focus';
import './admin.css';
import { DreamcoreLogo } from '../components/DreamcoreLogo';

const entries: Record<AdminRealm, { id: AdminPage; title: string; icon: LucideIcon }[]> = {
  tenant: [
    { id: 'overview', title: '知识工作台', icon: LayoutDashboard },
    { id: 'usage', title: '运行与用量', icon: Wallet },
    { id: 'engine', title: '运行看板', icon: Activity },
    { id: 'members', title: '成员与空间', icon: Users },
    { id: 'database', title: '数据底座', icon: Database },
    { id: 'catalog', title: '企业资料列表', icon: BookOpen },
    { id: 'governance', title: '数据治理', icon: SlidersHorizontal },
    { id: 'materials', title: '资料库', icon: Archive },
    { id: 'experience', title: '经验库', icon: BookOpen },
    { id: 'abilities', title: '智能服务', icon: Puzzle },
    { id: 'company', title: '企业信息', icon: Building2 },
    { id: 'audit', title: '操作审计', icon: Archive },
    { id: 'wiki', title: 'Wiki 知识', icon: BookOpen },
    { id: 'proposals', title: '业务提案', icon: Archive },
  ],
  platform: [
    { id: 'overview', title: '概览', icon: LayoutDashboard },
    { id: 'tenants', title: '企业列表', icon: Building2 },
    { id: 'usage', title: '用量与成本', icon: Wallet },
    { id: 'engine', title: '运行看板', icon: Activity },
    { id: 'database', title: '数据库', icon: Database },
    { id: 'materials', title: '资料库', icon: Archive },
    { id: 'experience', title: '经验库', icon: BookOpen },
    { id: 'capabilities', title: '引擎管理', icon: SlidersHorizontal },
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
  allowedPages,
  embedded = false,
  children,
}: {
  realm: AdminRealm;
  name: string;
  account: string;
  page: AdminPage;
  hash: string;
  logout: () => void;
  customerLinks?: ReactNode;
  allowedPages?: readonly AdminPage[];
  children: ReactNode;
  embedded?: boolean;
}) {
  const pending = useContext(RequestPending);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsedByRealm, setCollapsedByRealm] = useState(() => {
    const read = (key: AdminRealm) => {
      try {
        return localStorage.getItem('admin-navigation-collapsed:' + key) === 'true';
      } catch {
        return false;
      }
    };
    return { platform: read('platform'), tenant: read('tenant') };
  });
  const collapsed = collapsedByRealm[realm];
  const toggleNavigation = () => {
    const next = !collapsed;
    setCollapsedByRealm((previous) => ({ ...previous, [realm]: next }));
    try {
      localStorage.setItem('admin-navigation-collapsed:' + realm, String(next));
    } catch {
      /* Navigation remains usable when browser storage is unavailable. */
    }
  };
  const [titleTarget, setTitleTarget] = useState<HTMLDivElement | null>(null);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const navigationId = useId();
  const sidebar = useRef<HTMLElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const nav = entries[realm].filter((entry) => !allowedPages || allowedPages.includes(entry.id));
  const navigationPage = realm === 'platform' && page === 'accounts' ? 'tenants' : page;
  const title =
    navigationPage === 'settings' ? '设置' : nav.find((x) => x.id === navigationPage)?.title || '概览';
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 761px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);
  useLayoutEffect(() => {
    if (!mobileOpen || !sidebar.current) return;
    const navigation = sidebar.current;
    const focusable = () =>
      Array.from(
        navigation.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex="0"]'),
      ).filter((element) => element.getClientRects().length > 0);
    const focusNavigation = () => {
      const selected = navigation.querySelector<HTMLElement>('[aria-current="page"]');
      (selected || focusable()[0] || navigation).focus({ preventScroll: true });
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMobileOpen(false);
      } else if (event.key === 'Tab') {
        const target = navigationTabTarget(focusable(), document.activeElement, event.shiftKey);
        if (target) {
          event.preventDefault();
          target.focus({ preventScroll: true });
        }
      }
    };
    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof Node && !navigation.contains(event.target)) focusNavigation();
    };
    focusNavigation();
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', keepFocusInside);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', keepFocusInside);
      const trigger = menuTrigger.current;
      if (trigger?.isConnected && trigger.getClientRects().length > 0) trigger.focus({ preventScroll: true });
    };
  }, [mobileOpen]);
  useLayoutEffect(() => {
    document.title = `${title} · ${realm === 'platform' ? '总台 · 梦擎工作空间' : name + '企业管理'}`;
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
  if (embedded)
    return (
      <PageTitleContext.Provider value={titleTarget}>
        <PageActionsContext.Provider value={actions}>
          <div className="scene-business-body admin-control">
            <header className="scene-business-heading">
              <div ref={setTitleTarget}>{title}</div>
              <div ref={setActions} />
            </header>
            <main ref={main}>{children}</main>
          </div>
        </PageActionsContext.Provider>
      </PageTitleContext.Provider>
    );
  return (
    <CustomSelectContext.Provider value={realm === 'platform'}>
      <PageTitleContext.Provider value={titleTarget}>
        <PageActionsContext.Provider value={actions}>
          <div
            className={`admin-shell admin-control ${collapsed ? 'admin-navigation-collapsed' : ''} admin-${realm} ${page === 'engine' ? 'admin-engine-fullscreen' : ''} ${mobileOpen ? 'admin-menu-open' : ''}`}
          >
            {mobileOpen && (
              <button
                className="admin-scrim"
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => setMobileOpen(false)}
              />
            )}
            <aside
              className="admin-sidebar"
              id={navigationId}
              ref={sidebar}
              role={mobileOpen ? 'dialog' : undefined}
              aria-modal={mobileOpen ? true : undefined}
              tabIndex={mobileOpen ? -1 : undefined}
              aria-label={realm === 'platform' ? '总台导航' : '企业管理导航'}
            >
              <div className="admin-brand">
                <DreamcoreLogo />
                <div className="admin-brand-label">
                  <strong>梦擎引擎</strong>
                  <span className="admin-brand-english">Mengine</span>
                </div>
                <Button
                  className="admin-close-menu"
                  icon={X}
                  variant="ghost"
                  aria-label="关闭导航"
                  onClick={() => setMobileOpen(false)}
                />
              </div>
              {realm !== 'platform' && (
                <div className="admin-scope" title={name}>
                  {name}
                </div>
              )}
              {(realm === 'platform'
                ? [
                    {
                      label: '梦擎引擎',
                      items: nav.filter((item) =>
                        ['engine', 'database', 'materials', 'experience', 'capabilities'].includes(item.id),
                      ),
                    },
                    {
                      label: '平台管理',
                      items: nav.filter((item) => ['overview', 'tenants', 'usage'].includes(item.id)),
                    },
                  ]
                : [
                    {
                      label: '梦擎引擎',
                      items: nav.filter((item) =>
                        ['engine', 'database', 'catalog', 'materials', 'experience', 'wiki', 'abilities'].includes(
                          item.id,
                        ),
                      ),
                    },
                    {
                      label: '企业管理',
                      items: nav.filter((item) =>
                        [
                          'overview',
                          'governance',
                          'members',
                          'company',
                          'usage',
                          'audit',
                          'proposals',
                        ].includes(item.id),
                      ),
                    },
                  ]
              )
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <section className="admin-nav-group" key={group.label}>
                    {group.label && <div className="admin-nav-group-title">{group.label}</div>}
                    <nav aria-label={group.label || '企业管理功能'}>
                      {group.items.map(({ id, title, icon: Icon }) => (
                        <a
                          key={id}
                          aria-label={title}
                          title={title}
                          className={`admin-nav-link ${navigationPage === id ? 'active' : ''}`}
                          aria-current={page === id ? 'page' : undefined}
                          href={adminHref(realm, id, hash)}
                          onClick={(e) => {
                            if (pending) e.preventDefault();
                            else setMobileOpen(false);
                          }}
                        >
                          <Icon size={20} aria-hidden="true" />
                          <span>{title}</span>
                        </a>
                      ))}
                    </nav>
                  </section>
                ))}
              <div className="admin-sidebar-footer">
                <div className="admin-navigation-toggle-row">
                  {realm === 'platform' && (
                    <a
                      className={`admin-nav-link ${page === 'settings' ? 'active' : ''}`}
                      aria-current={page === 'settings' ? 'page' : undefined}
                      href={adminHref(realm, 'settings', hash)}
                      aria-label="设置"
                      title="设置"
                      onClick={(e) => {
                        if (pending) e.preventDefault();
                        else setMobileOpen(false);
                      }}
                    >
                      <Settings size={20} aria-hidden="true" />
                      <span>设置</span>
                    </a>
                  )}
                  <button
                    type="button"
                    className="admin-navigation-toggle"
                    aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
                    title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
                    aria-expanded={!collapsed}
                    aria-controls={navigationId}
                    onClick={toggleNavigation}
                  >
                    {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                  </button>
                </div>
                {customerLinks && <div className="admin-customer-links">{customerLinks}</div>}
                <div className="admin-account" title={account}>
                  <span className="admin-account-avatar" aria-hidden="true">
                    {Array.from(account.trim())[0] || '账'}
                  </span>
                  <div className="admin-account-label">
                    <strong title={account}>{account}</strong>
                    <small>
                      {realm === 'platform' || new URLSearchParams(hash.replace(/^#/, '')).has('support')
                        ? '总部账号'
                        : '企业账号'}
                    </small>
                  </div>
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
            <div className="admin-main" inert={mobileOpen}>
              <header className="admin-header">
                <div className="admin-heading">
                  <button
                    type="button"
                    className="button ghost admin-open-menu"
                    ref={menuTrigger}
                    aria-label="展开导航"
                    aria-expanded={mobileOpen}
                    aria-controls={navigationId}
                    aria-haspopup="dialog"
                    onClick={() => setMobileOpen(true)}
                  >
                    <Menu size={16} strokeWidth={1.7} aria-hidden="true" />
                  </button>
                  <div className="admin-title-slot" ref={setTitleTarget}>
                    <div className="admin-default-title">
                      <h1>{title}</h1>
                    </div>
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
      </PageTitleContext.Provider>
    </CustomSelectContext.Provider>
  );
}
