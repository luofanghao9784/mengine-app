import { useEffect, useState } from 'react';
import { Boxes, LayoutGrid, PanelLeftClose, PanelLeftOpen, Puzzle } from 'lucide-react';
import { DreamcoreLogo } from '../../components/DreamcoreLogo';
import '../../admin/admin.css';
import './agent-admin.css';
import { agentRoute } from './routes';
import { probeCapabilities } from './client';
import { RegisterDialog } from './RegisterDialog';

const functions = [
  ['document-parse', '文档解析', '将文档转为可用的结构化内容', '只读种子'],
  ['table-compare', '表格比对', '比较表格内容与差异', '只读种子'],
  ['quality-check', '质量检查', '浏览并登记质量检查的能力实现', '开放登记入口'],
  ['semantic-annotation', '语义标注', '为内容补充语义信息', '未启用'],
  ['repair-suggestion', '修复建议', '为发现的问题提供修复建议', '未启用'],
];

export function AgentAdminApp() {
  const [hash, setHash] = useState(location.hash);
  const [collapsed, setCollapsed] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const route = agentRoute(hash);
  const [registerOpen, setRegisterOpen] = useState(false);
  useEffect(() => {
    const changed = () => setHash(location.hash);
    window.addEventListener('hashchange', changed);
    const controller = new AbortController();
    void probeCapabilities(controller.signal).then((value) => {
      if (!controller.signal.aborted) setConnected(value);
    });
    return () => {
      window.removeEventListener('hashchange', changed);
      controller.abort();
    };
  }, []);
  return (
    <div className={`admin-shell admin-control agent-admin ${collapsed ? 'admin-navigation-collapsed' : ''}`}>
      <aside className="admin-sidebar" aria-label="统一 Agent 管理导航">
        <div className="admin-brand">
          <DreamcoreLogo />
          <div className="admin-brand-label">
            <strong>梦核引擎</strong>
            <span className="admin-brand-english">Mengine</span>
          </div>
        </div>
        <div className="admin-scope">统一 Agent 管理</div>
        <section className="admin-nav-group">
          <div className="admin-nav-group-title">平台能力</div>
          <nav id="agent-navigation" aria-label="平台能力">
            {(
              [
                ['functions', '企业端功能', LayoutGrid],
                ['capability-registry', '能力登记', Boxes],
              ] as const
            ).map(([view, title, Icon]) => (
              <a
                key={view}
                href={`#view=${view}`}
                title={title}
                aria-label={title}
                aria-current={route.view === view ? 'page' : undefined}
                className={`admin-nav-link ${route.view === view ? 'active' : ''}`}
              >
                <Icon size={20} aria-hidden="true" />
                <span>{title}</span>
              </a>
            ))}
          </nav>
        </section>
        <div className="admin-sidebar-footer">
          <button
            className="admin-navigation-toggle"
            aria-controls="agent-navigation"
            aria-expanded={!collapsed}
            aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <p className="agent-session">独立会话 · 免登浏览壳</p>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <h1>{route.view === 'functions' ? '企业端功能' : '能力登记'}</h1>
          <span>平台级模型能力与 Agent 注册</span>
        </header>
        <main className="admin-content" id="agent-main">
          <p className="agent-connection" role="status">
            {connected === null
              ? '正在探测后端连接…'
              : connected
                ? '只读接口已连接；能力目录契约待对接，当前不展示实现列表。'
                : '尚未连接后端或未登录'}
          </p>
          {route.view === 'functions' ? (
            <>
              <p className="agent-intro">
                按企业端功能管理能力实现。以下为功能闭集说明，不代表已登记的实现。
              </p>
              <div className="agent-functions">
                {functions.map(([id, title, description, status]) => (
                  <section className="admin-panel agent-function" key={id}>
                    <Puzzle size={22} aria-hidden="true" />
                    <span className="agent-badge">{status}</span>
                    <h2>{title}</h2>
                    <code>{id}</code>
                    <p>{description}</p>
                    {id === 'quality-check' ? (
                      <a className="button primary" href="#view=capability-registry&tab=catalog">
                        查看能力登记 →
                      </a>
                    ) : (
                      <small>当前未开放登记</small>
                    )}
                  </section>
                ))}
              </div>
            </>
          ) : (
            <>
              <nav className="agent-tabs" aria-label="能力登记分类">
                {(
                  [
                    ['catalog', '能力目录'],
                    ['versions', '版本管理'],
                    ['grants', '授权管理'],
                  ] as const
                ).map(([tab, title]) => (
                  <a
                    key={tab}
                    href={`#view=capability-registry&tab=${tab}`}
                    aria-current={route.tab === tab ? 'page' : undefined}
                  >
                    {title}
                  </a>
                ))}
              </nav>
              {route.tab === 'catalog' ? (
                <>
                  <section aria-labelledby="agent-seeds-title" className="agent-catalog-section">
                    <h2 id="agent-seeds-title">登记种子</h2>
                    <p className="agent-intro">
                      前端闭集说明卡，不代表 Live 已登记实现。首版仅开放质量检查的登记面板。
                    </p>
                    <div className="agent-functions">
                      {[functions[2], functions[0], functions[1]].map(([id, title, description]) => (
                        <section className="admin-panel agent-function" key={id}>
                          <Puzzle size={22} aria-hidden="true" />
                          <span
                            className={`agent-badge ${id === 'quality-check' ? '' : 'agent-badge-readonly'}`}
                          >
                            {id === 'quality-check' ? '登记种子 · 可登记' : '只读种子'}
                          </span>
                          <h3>{title}</h3>
                          <code>{id}</code>
                          <p>{description}</p>
                          {id === 'quality-check' ? (
                            <button className="button primary" onClick={() => setRegisterOpen(true)}>
                              从本种子登记
                            </button>
                          ) : (
                            <small>仅供查看，暂不开放登记与编辑</small>
                          )}
                        </section>
                      ))}
                    </div>
                  </section>
                  <section className="agent-catalog-section" aria-labelledby="agent-live-title">
                    <h2 id="agent-live-title">Live 已登记实现</h2>
                    <div className="admin-panel agent-empty">
                      <Boxes size={40} aria-hidden="true" />
                      <h3>尚无 Live 已登记实现</h3>
                      <p>
                        {connected === null
                          ? '正在探测后端连接，尚未加载登记列表。'
                          : connected
                            ? '只读接口已连接；列表契约待对接，当前无可安全展示的实现。'
                            : '尚未连接后端或未登录，当前未加载登记列表。'}
                      </p>
                      <button className="button primary" onClick={() => setRegisterOpen(true)}>
                        登记第一个实现
                      </button>
                      <p>仅打开登记面板；写 API 未就绪（CT-018）</p>
                    </div>
                  </section>
                  <RegisterDialog open={registerOpen} onClose={() => setRegisterOpen(false)} />
                </>
              ) : (
                <section className="admin-panel agent-empty">
                  <Boxes size={40} aria-hidden="true" />
                  <h2>即将提供</h2>
                  <p>版本与授权管理将在后续切片开放。</p>
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
