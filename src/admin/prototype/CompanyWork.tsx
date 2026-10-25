import { useContext, useEffect, useState } from 'react';
import { useRemote } from '../../shared/admin';
import { RequestPending } from '../../shared/request-guard';
import { useSession } from '../../identity/session';
import { governanceClient } from '../../governance/client';
import { companyClient, companyFields, type CompanyChange, type CompanyGroup, type CompanyTag } from '../../profile/company-client';
import { CompanyEditor, analysisSummary } from '../../profile/CompanyInformation';
import { CompanySuggestions } from '../../profile/CompanySuggestions';
import { TenantAdminHome } from '../../tenant/TenantAdminHome';
import { NewsSources } from '../../news/NewsSources';
import { ExpressionPreferencesPanel } from '../../preferences/ExpressionPreferencesPanel';
import { TenantAudit } from '../../tenant/TenantAudit';
import { DeparturePanel } from '../../departure/DeparturePanel';
import { KnowledgeListRow } from './KnowledgeListRow';
import { Facts, SectionTabs, errorText, useHashParams } from './section-kit';

/**
 * 企业信息：一排页签（企业背景 / 企业设置 / AI 内容偏好 / 资讯来源 / 管理记录 / 保留与退出，按权限出现）。
 * 企业背景是“清单 + 详情”：左边四项背景与自动整理建议，右边所选一项的内容与调整；
 * 其余栏目是表单或记录，用一张宽卡片承载，内容沿用原有功能。
 */
type Tab = 'background' | 'settings' | 'preferences' | 'news' | 'records' | 'retention';
const NAMES: Record<Tab, string> = {
  background: '企业背景',
  settings: '企业设置',
  preferences: 'AI 内容偏好',
  news: '资讯来源',
  records: '管理记录',
  retention: '保留与退出',
};
const NOTES: Record<Tab, string> = {
  background: '名称、行业、业务与术语',
  settings: '基础设置与企业配置',
  preferences: '表达方式与内容重点',
  news: '资讯渠道与订阅范围',
  records: '操作历史与管理审计',
  retention: '数据保留与退出管理',
};

export function CompanyWork({ tenant }: { tenant: string }) {
  const { session } = useSession();
  const [params, write] = useHashParams();
  const governance = useRemote((s) => governanceClient.snapshot(tenant, s), [tenant, session.identity]);
  const g = governance.value;
  const scoped = (cap: string) => !!g?.capabilities.some((c) => c.capability === cap && c.workspaceId === null);
  const tabs: Tab[] = g
    ? [
        'background',
        ...(g.canConfigure ? (['settings'] as Tab[]) : []),
        'preferences',
        ...(g.canConfigure ? (['news', 'records'] as Tab[]) : []),
        ...(g.canConfigure || scoped('TENANT_EXIT') ? (['retention'] as Tab[]) : []),
      ]
    : [];
  const allowed = !!g && (g.canConfigure || scoped('PROFILE_MAINTAIN') || scoped('TENANT_EXIT'));
  // 旧链接用 detail=settings 等指栏目，这里也认。
  const asked = (params.get('tab') || params.get('detail')) as Tab | null;
  const tab: Tab = asked && tabs.includes(asked) ? asked : 'background';
  const go = (t: Tab) => write({ tab: t, item: null, detail: null }, true);
  const tabBar = <SectionTabs label="企业信息栏目" tabs={tabs.map((t) => [t, NAMES[t]])} active={tab} onChange={go} />;

  if (governance.error || !g || !allowed)
    return (
      <section className="cards work glass section-work wide company-work" aria-label="企业信息">
        <article className="card wide-card">
          <p className="none">
            {governance.error
              ? errorText(governance.error)
              : !g
                ? '正在读取管理权限…'
                : '企业信息由企业负责人或管理员维护；当前账号没有这一板块的管理职责。'}
          </p>
        </article>
      </section>
    );

  return (
    <section className={`cards work glass section-work company-work${tab === 'background' ? '' : ' wide'}`} aria-label="企业信息">
      {tab === 'background' ? (
        <Background tenant={tenant} tabBar={tabBar} selected={params.get('item') || ''} select={(id) => write({ item: id })} />
      ) : (
        <>
          <article className="card wide-card">
            {tabBar}
            <div className="card-scroll embedded legacy-skin">
              <p className="note section-note">{NOTES[tab]}</p>
              {tab === 'settings' ? (
                <TenantAdminHome key={tenant + ':settings'} tenant={tenant} compact hideNavigation initialTab="settings" />
              ) : tab === 'news' ? (
                <NewsSources key={tenant} tenant={tenant} />
              ) : tab === 'preferences' ? (
                <ExpressionPreferencesPanel key={tenant} scope="TENANT" tenant={tenant} />
              ) : tab === 'records' ? (
                <TenantAudit key={tenant + ':records'} tenant={tenant} />
              ) : (
                <DeparturePanel key={tenant} tenant={tenant} only="exit" />
              )}
            </div>
          </article>
          <div className="side">
            <CompanyFactsLoader tenant={tenant} />
          </div>
        </>
      )}
    </section>
  );
}

function useCompany(tenant: string, paused: boolean) {
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0);
  // 自动整理在后台进行：看着的时候每 30 秒读一次，编辑时暂停。
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setAttempt((n) => n + 1);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [paused, tenant]);
  const data = useRemote((s) => companyClient.get(tenant, s), [tenant, attempt, session.identity]);
  const analysis = useRemote((s) => companyClient.analysis(tenant, s), [tenant, attempt, session.identity]);
  return { data, analysis, refresh: () => setAttempt((n) => n + 1) };
}

function CompanyFactsLoader({ tenant }: { tenant: string }) {
  const { data, analysis } = useCompany(tenant, false);
  return <CompanyFacts data={data} analysis={analysis} />;
}
type Company = ReturnType<typeof useCompany>;
function CompanyFacts({ data, analysis }: Pick<Company, 'data' | 'analysis'>) {
  const groups = data.value?.groups || [];
  const count = (f: CompanyGroup['field']) => groups.find((x) => x.field === f)?.tags.length;
  return (
    <>
      <Facts
        title="企业背景"
        rows={[
          ['企业名称', groups.find((x) => x.field === 'NAME')?.tags[0]?.label || (data.value ? '未填写' : undefined)],
          ['所属行业', count('INDUSTRY')],
          ['主营业务', count('BUSINESS')],
          ['业务术语', count('TERM')],
        ]}
      />
      <article className="card facts more">
        <header>
          <h2>自动整理</h2>
        </header>
        <div className="fact line">
          <span>
            {analysis.error
              ? '暂时无法读取自动整理状态。'
              : analysis.value
                ? analysisSummary(analysis.value)
                : '正在读取自动整理状态…'}
          </span>
        </div>
        <div className="fact line">
          <span>从获准资料整理企业背景，不表示知识已使用这些背景。全部选填，不改变企业身份、组织或权限。</span>
        </div>
      </article>
    </>
  );
}

function Background({
  tenant,
  tabBar,
  selected,
  select,
}: {
  tenant: string;
  tabBar: React.ReactNode;
  selected: string;
  select: (id: string) => void;
}) {
  const pending = useContext(RequestPending);
  const [edit, setEdit] = useState<{ group: CompanyGroup; tag?: CompanyTag; action: CompanyChange['action'] } | null>(null);
  const [notice, setNotice] = useState('');
  const { data, analysis, refresh } = useCompany(tenant, !!edit || pending);
  const groups = data.value?.groups || [];
  const canMaintain = !!data.value?.canMaintain;
  const pick = selected === 'suggestions' && canMaintain ? 'suggestions' : groups.find((x) => x.field === selected)?.field || groups[0]?.field;
  const group = groups.find((x) => x.field === pick);
  return (
    <>
      <article className="card list">
        {tabBar}
        <header className="list-head">
          <h2>背景项</h2>
          <span className="head-tools">
            <button type="button" className="icon" title="刷新" aria-label="刷新" disabled={pending} onClick={refresh}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" />
              </svg>
            </button>
          </span>
        </header>
        <div className="card-scroll">
          {data.error ? (
            <p className="none">{errorText(data.error)}</p>
          ) : !data.value ? (
            <p className="none">正在读取企业背景…</p>
          ) : (
            <>
              {groups.map((x) => (
                <KnowledgeListRow
                  key={x.field}
                  name={companyFields[x.field]}
                  summary={
                    x.tags.length
                      ? x.tags.map((t) => t.label).join('、')
                      : x.manuallyCleared
                        ? '已由人工清空，保持为空'
                        : '尚未填写，不影响使用'
                  }
                  side={x.field === 'NAME' ? undefined : `${x.tags.length} 项`}
                  tone={x.tags.length ? 'ok' : 'plain'}
                  selected={x.field === pick}
                  onSelect={() => select(x.field)}
                />
              ))}
              {canMaintain && (
                <>
                  <h3>自动整理</h3>
                  <KnowledgeListRow
                    name="整理建议"
                    summary="从获准资料整理出的待确认建议"
                    tone="run"
                    selected={pick === 'suggestions'}
                    onSelect={() => select('suggestions')}
                  />
                </>
              )}
            </>
          )}
        </div>
      </article>

      <article className="card detail" aria-live="polite">
        {pick === 'suggestions' ? (
          <>
            <header>
              <h2>整理建议</h2>
              <span>确认后写入企业背景；人工调整优先保留</span>
            </header>
            <div className="card-scroll legacy-skin">
              <CompanySuggestions
                tenant={tenant}
                groups={groups}
                changed={() => {
                  setNotice('处理结果已保存。');
                  refresh();
                }}
              />
            </div>
          </>
        ) : !group ? (
          <p className="none">{data.error ? errorText(data.error) : '正在读取…'}</p>
        ) : (
          <>
            <header>
              <h2>{companyFields[group.field]}</h2>
              <span>选填 · {group.tags.length} 项</span>
            </header>
            <div className="card-scroll">
              <p className="verdict">
                {notice ||
                  (analysis.value ? analysisSummary(analysis.value) : analysis.error ? '暂时无法读取自动整理状态。' : '正在读取自动整理状态…')}
              </p>
              {group.tags.length ? (
                <div className="tag-list">
                  {group.tags.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      disabled={pending}
                      onClick={() => setEdit({ group, tag: t, action: 'EDIT' })}
                      title="查看来源与修改记录"
                    >
                      <b>{t.label}</b>
                      {t.meaning && <span>{t.meaning}</span>}
                      <small>{t.origin === 'AI' ? 'AI 整理' : '人工调整'}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="note">{group.manuallyCleared ? '已由人工清空，保持为空。' : '尚未填写，不影响使用。'}</p>
              )}
              {group.tags.length > 0 && (
                <p className="note">点击条目查看来源、修改记录与知识使用情况{canMaintain ? '，或调整内容' : ''}。</p>
              )}
            </div>
            {canMaintain && (
              <footer>
                {(group.field !== 'NAME' || !group.tags.length) && (
                  <button
                    type="button"
                    className="primary"
                    disabled={pending || group.tags.length >= 30}
                    onClick={() => setEdit({ group, action: 'ADD' })}
                  >
                    {group.field === 'NAME' ? '填写名称' : '添加标签'}
                  </button>
                )}
                {group.tags.length > 0 && (
                  <button type="button" className="danger" disabled={pending} onClick={() => setEdit({ group, action: 'CLEAR' })}>
                    清空此项
                  </button>
                )}
              </footer>
            )}
          </>
        )}
      </article>

      <div className="side">
        <CompanyFacts data={data} analysis={analysis} />
      </div>

      {edit && data.value && (!edit.tag || groups.some((x) => x.field === edit.group.field && x.tags.some((t) => t.id === edit.tag?.id))) && (
        <CompanyEditor
          key={edit.group.field + (edit.tag?.id || edit.action)}
          tenant={tenant}
          {...edit}
          writable={canMaintain}
          close={() => setEdit(null)}
          changed={() => {
            setEdit(null);
            setNotice('企业背景已保存。结构化背景知识随来源更新；关联方法可能需要核对，请查看条目详情中的知识使用情况。');
            refresh();
          }}
        />
      )}
    </>
  );
}
