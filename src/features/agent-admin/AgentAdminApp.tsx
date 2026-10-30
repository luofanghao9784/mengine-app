import { useEffect, useRef, useState } from 'react';
import { Boxes, LayoutGrid, PanelLeftClose, PanelLeftOpen, Puzzle } from 'lucide-react';
import { DreamcoreLogo } from '../../components/DreamcoreLogo';
import '../../admin/admin.css';
import './agent-admin.css';
import { agentRoute } from './routes';
import { createCapabilityTenantGrant, listCapabilities } from './client';
import type { CapabilityListResult } from './client';
import { RegisterDialog } from './RegisterDialog';

const functions = [
  ['document-parse', '文档解析', '将文档转为可用的结构化内容', '仅供查看'],
  ['table-compare', '表格比对', '比较表格内容与差异', '仅供查看'],
  ['quality-check', '质量检查', '查看质量检查说明，预览 AI 功能实现方案登记表', '可登记说明'],
  ['semantic-annotation', '语义标注', '为内容补充语义信息', '未启用'],
  ['repair-suggestion', '修复建议', '为发现的问题提供修复建议', '未启用'],
];

export function AgentAdminApp() {
  const [hash, setHash] = useState(location.hash);
  const [collapsed, setCollapsed] = useState(false);
  const [capabilities, setCapabilities] = useState<CapabilityListResult | { status: 'loading' }>({
    status: 'loading',
  });
  const [listAttempt, setListAttempt] = useState(0);
  const connected =
    capabilities.status === 'loading'
      ? null
      : capabilities.status === 'ok' || capabilities.status === 'empty';
  const route = agentRoute(hash);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [enterprise, setEnterprise] = useState('');
  const [grantStatus, setGrantStatus] = useState('');
  const [grantPending, setGrantPending] = useState(false);
  const grantInFlight = useRef(false);

  async function submitGrant() {
    if (grantInFlight.current) return;
    if (!enterprise.trim()) {
      setGrantStatus('请按要求填写开通内容');
      return;
    }
    grantInFlight.current = true;
    setGrantPending(true);
    setGrantStatus('正在开通…');
    try {
      setGrantStatus(await createCapabilityTenantGrant(enterprise));
    } finally {
      grantInFlight.current = false;
      setGrantPending(false);
    }
  }

  useEffect(() => {
    const changed = () => setHash(location.hash);
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setCapabilities({ status: 'loading' });
    void listCapabilities(controller.signal)
      .catch((): CapabilityListResult => ({ status: 'failed' }))
      .then((value) => {
        if (!controller.signal.aborted) setCapabilities(value);
      });
    return () => controller.abort();
  }, [listAttempt]);
  return (
    <div className={`admin-shell admin-control agent-admin ${collapsed ? 'admin-navigation-collapsed' : ''}`}>
      <aside className="admin-sidebar" aria-label="AI 功能管理导航">
        <div className="admin-brand">
          <DreamcoreLogo />
          <div className="admin-brand-label">
            <strong>梦擎引擎</strong>
            <span className="admin-brand-english">Mengine</span>
          </div>
        </div>
        <div className="admin-scope">AI 功能管理台</div>
        <section className="admin-nav-group">
          <div className="admin-nav-group-title">AI 功能</div>
          <nav id="agent-navigation" aria-label="AI 功能">
            {(
              [
                ['functions', '企业功能', LayoutGrid],
                ['capability-registry', '功能上架', Boxes],
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
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <h1>{route.view === 'functions' ? '企业功能' : '功能上架'}</h1>
          <span>总部给企业上架、开通 AI 功能的后台</span>
        </header>
        <main className="admin-content" id="agent-main">
          <p className="agent-connection" role="status">
            {connected === null ? '正在检查后台连接…' : connected ? '已连接后台' : '尚未连接后台或未登录'}
          </p>
          {route.view === 'functions' ? (
            <>
              <p className="agent-intro">按企业功能查看 AI 功能说明。以下为说明样例，不代表已经上架。</p>
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
                        去功能上架 →
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
              <nav className="agent-tabs" aria-label="功能上架分类">
                {(
                  [
                    ['catalog', '功能上架'],
                    ['versions', '版本'],
                    ['grants', '企业开通'],
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
                    <h2 id="agent-seeds-title">说明样例</h2>
                    <p className="agent-intro">
                      以下样例说明这里管理哪些 AI 功能，不代表已经上架。目前仅可从质量检查打开实现方案登记表。
                    </p>
                    <div className="agent-functions">
                      {[functions[2], functions[0], functions[1]].map(([id, title, description]) => (
                        <section className="admin-panel agent-function" key={id}>
                          <Puzzle size={22} aria-hidden="true" />
                          <span
                            className={`agent-badge ${id === 'quality-check' ? '' : 'agent-badge-readonly'}`}
                          >
                            {id === 'quality-check' ? '可登记说明' : '仅供查看'}
                          </span>
                          <h3>{title}</h3>
                          <code>{id}</code>
                          <p>{description}</p>
                          {id === 'quality-check' ? (
                            <button className="button primary" onClick={() => setRegisterOpen(true)}>
                              登记实现方案
                            </button>
                          ) : (
                            <small>仅供查看，暂不开放登记与编辑</small>
                          )}
                        </section>
                      ))}
                    </div>
                  </section>
                  <section className="agent-catalog-section" aria-labelledby="agent-live-title">
                    <h2 id="agent-live-title">已上架</h2>
                    <div
                      key={capabilities.status}
                      className="agent-live-content"
                      aria-busy={capabilities.status === 'loading'}
                    >
                      {capabilities.status === 'ok' ? (
                        <div className="agent-functions">
                          {capabilities.items.map((item) => (
                            <section className="admin-panel agent-function" key={item.capabilityId}>
                              <h3>{item.name}</h3>
                              <code>编号：{item.capabilityId}</code>
                              <p>
                                企业功能：
                                {functions.find(([id]) => id === item.enterpriseFunction)?.[1] ?? '未指定'}
                              </p>
                            </section>
                          ))}
                        </div>
                      ) : (
                        <div className="admin-panel agent-empty">
                          <Boxes size={40} aria-hidden="true" />
                          <p role="status">
                            {capabilities.status === 'loading'
                              ? '正在加载已上架的功能…'
                              : capabilities.status === 'empty'
                                ? '还没有已上架的功能。在上方登记实现方案并上架后会出现在这里。'
                                : capabilities.status === 'unauthenticated'
                                  ? '还没有登录，请先登录后再试'
                                  : '暂时无法读取已上架的功能，请稍后重试'}
                          </p>
                          {capabilities.status === 'failed' && (
                            <button
                              className="button primary"
                              onClick={() => {
                                setCapabilities({ status: 'loading' });
                                setListAttempt((attempt) => attempt + 1);
                              }}
                            >
                              重试
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </section>
                  <RegisterDialog open={registerOpen} onClose={() => setRegisterOpen(false)} />
                </>
              ) : (
                <section className="admin-panel agent-empty" aria-labelledby="agent-readonly-title">
                  <Boxes size={40} aria-hidden="true" />
                  <h2 id="agent-readonly-title">{route.tab === 'versions' ? '版本 · 只读' : '企业开通'}</h2>
                  <h3>{route.tab === 'versions' ? '尚无可展示的版本' : '尚无可展示的企业开通记录'}</h3>
                  <p>
                    {connected === null
                      ? '正在检查后台连接，当前未加载列表。'
                      : connected
                        ? '已连接后台；AI 功能列表暂未接入，当前无法展示。'
                        : '尚未连接后台或未登录，当前未加载列表。'}
                  </p>
                  {route.tab === 'versions' ? (
                    <>
                      <p>AI 功能暂不能上架或开通给企业（后台开通中）</p>
                      <div className="agent-readonly-actions" aria-label="暂未开放的 AI 功能操作">
                        <button className="button" disabled title="暂时不能上架（后台开通中）">
                          上架功能
                        </button>
                      </div>
                    </>
                  ) : (
                    <form
                      className="agent-grant-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submitGrant();
                      }}
                    >
                      <label className="field">
                        <span>企业</span>
                        <input
                          placeholder="填写企业编号"
                          value={enterprise}
                          onChange={(event) => setEnterprise(event.target.value)}
                          disabled={grantPending}
                        />
                      </label>
                      <label className="field">
                        <span>企业功能</span>
                        <input value="质量检查" readOnly />
                      </label>
                      <button type="submit" className="button" disabled={grantPending}>
                        开通给企业
                      </button>
                      <p role="status">{grantStatus}</p>
                    </form>
                  )}
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
