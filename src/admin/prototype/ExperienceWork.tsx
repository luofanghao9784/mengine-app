import { useEffect, useState } from 'react';
import { uuid } from '../../identity/client';
import { useSession } from '../../identity/session';
import { PageActionsContext } from '../../shared/ui';
import { requestNavigationLocked } from '../../shared/request-guard';
import { textState, useViewState } from '../../shared/useViewState';
import { ExperienceDrawer } from '../../experience/TenantExperiences';
import { GeneralExperienceLibrary } from '../../experience/GeneralExperienceLibrary';
import { experienceManagementClient as api, processingLabels, reasonLabels } from '../../experience/management-client';
import type {
  ExperienceProcessingPage,
  ExperienceProcessingRecord,
  ExperienceScope,
  ManagedExperience,
} from '../../../contracts/public-api/experience-management';
import { KnowledgeListRow } from './KnowledgeListRow';
import { Facts, ListBody, ListHead, SectionTabs, errorText, useDebounced, useHashParams, usePaged } from './section-kit';
import type { Tone } from './data';

/**
 * 经验库：一排页签（企业经验 / 通用经验 / 积累与改进）。
 * 企业经验与积累与改进是“清单 + 详情”：左边经验或处理记录，右边经验详情（停用与恢复、调整、版本与依据沿用原功能）；
 * 通用经验沿用原有通用经验库，放在一张宽卡片里。
 */
type Tab = 'enterprise' | 'general' | 'processing';
const NAMES: Record<Tab, string> = { enterprise: '企业经验', general: '通用经验', processing: '积累与改进' };
const stamp = (date: string) =>
  new Date(date).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const SOURCE: Record<ExperienceProcessingRecord['sourceKind'], string> = {
  GENERAL_SUGGESTION: '通用经验补充与反馈',
  ADJUSTMENT: '经验内容调整',
  FEEDBACK: '反馈关联内容',
  TASK: '任务执行结果',
};
const tone = (state: string): Tone =>
  ['ADMITTED', 'UPDATED'].includes(state)
    ? 'ok'
    : ['FAILED', 'UNKNOWN', 'UNAVAILABLE'].includes(state)
      ? 'bad'
      : ['WAITING', 'PROCESSING', 'RETRYING'].includes(state)
        ? 'run'
        : 'plain';

export function ExperienceWork({ tenant }: { tenant: string }) {
  const { session } = useSession();
  const [params, write] = useHashParams();
  // 旧链接：#experience=…&scope=… 直接打开这条企业经验。
  const legacy = uuid(params.get('experience')) && uuid(params.get('scope'));
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = legacy ? 'enterprise' : asked && asked in NAMES ? asked : 'enterprise';
  const item = params.get('item') || (legacy ? params.get('experience') : '') || '';
  const itemSpace = params.get('space') || (legacy ? params.get('scope') : '') || '';
  const version = params.get('version');
  const [locked, setLocked] = useState(false);
  const go = (t: Tab) => {
    if (locked || requestNavigationLocked()) return;
    write({ tab: t, item: null, space: null, version: null, experience: null, scope: null }, true);
  };
  const open = (id: string, space: string, v: string | null, t: Tab = tab) =>
    write({ tab: t, item: id, space, version: v, experience: null, scope: null }, t !== tab);

  const [space, setSpace] = useViewState(tenant, 'experience:scope', '', (v): v is string => v === '' || uuid(v));
  const [q, setQ] = useViewState(tenant, 'experience:query', '', textState);
  const query = useDebounced(q);
  const [contentState, setContentState] = useViewState(
    tenant,
    'experience:content-state',
    'AVAILABLE',
    (v): v is string => v === 'AVAILABLE' || v === 'STOPPED',
  );
  const [state, setState] = useViewState(
    tenant,
    'experience:processing-state',
    'ALL',
    (v): v is string => typeof v === 'string' && (v === 'ALL' || v in processingLabels),
  );
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((n) => n + 1);
  // 积累与改进由系统自动处理：看着的时候每 30 秒更新一次状态。
  useEffect(() => {
    if (tab !== 'processing' || locked) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !requestNavigationLocked()) setAttempt((n) => n + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, [tab, locked]);
  const contents = usePaged<ManagedExperience, { scopes: ExperienceScope[] }>(
    (offset, s) => (tab === 'enterprise' ? api.contents(tenant, space, query, contentState, offset, s) : Promise.resolve([])),
    [tenant, tab, space, query, contentState, attempt, session.identity],
  );
  const processing = usePaged<ExperienceProcessingRecord, Omit<ExperienceProcessingPage, 'items' | 'hasMore'>>(
    (offset, s) => (tab === 'processing' ? api.processing(tenant, space, state, offset, s) : Promise.resolve([])),
    [tenant, tab, space, state, attempt, session.identity],
  );
  const scopes = contents.value?.meta?.scopes || processing.value?.meta?.scopes || [];
  const meta = processing.value?.meta;
  const [generalActions, setGeneralActions] = useState<HTMLDivElement | null>(null);

  const tabBar = <SectionTabs label="经验库栏目" tabs={(Object.keys(NAMES) as Tab[]).map((t) => [t, NAMES[t]])} active={tab} onChange={go} />;
  const scopeSelect = (
    <select
      aria-label="经验范围"
      disabled={locked}
      value={space}
      onChange={(e) => {
        setSpace(e.target.value);
        write({ item: null, space: null, version: null });
      }}
    >
      <option value="">全部获权空间</option>
      {scopes.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );

  if (tab === 'general')
    return (
      <section className="cards work glass section-work wide experience-work" aria-label="经验库">
        <article className="card wide-card">
          {tabBar}
          <header className="list-head">
            <h2>通用经验</h2>
            <div className="head-tools" ref={setGeneralActions} />
          </header>
          <div className="card-scroll embedded legacy-skin">
            <PageActionsContext.Provider value={generalActions}>
              <GeneralExperienceLibrary
                tenant={tenant}
                onLocked={setLocked}
                chooseLocal={(selection) => open(selection.id, selection.space, selection.version, 'enterprise')}
              />
            </PageActionsContext.Provider>
          </div>
        </article>
        <div className="side">
          <article className="card facts more">
            <header>
              <h2>说明</h2>
            </header>
            <div className="fact line">
              <span>通用经验来自平台，可在本企业补充本地版本或反馈；采用后作为企业经验管理。</span>
            </div>
          </article>
        </div>
      </section>
    );

  const items = tab === 'enterprise' ? contents.value?.items || [] : [];
  const records = tab === 'processing' ? processing.value?.items || [] : [];
  const selected =
    tab === 'enterprise'
      ? items.find((x) => x.experience.id === item) || (item ? undefined : items[0])
      : undefined;
  const record = tab === 'processing' ? records.find((x) => x.id === item) || (item ? undefined : records[0]) : undefined;
  const detailId = tab === 'enterprise' ? selected?.experience.id || item : record?.entryId || '';
  const detailSpace = tab === 'enterprise' ? selected?.workspaceId || itemSpace : record?.workspaceId || '';
  const detailVersion = tab === 'enterprise' ? (selected && item === selected.experience.id ? version : null) || selected?.experience.versionId || version : record?.versionId || null;

  return (
    <section className="cards work glass section-work experience-work" aria-label="经验库">
      <article className="card list">
        {tabBar}
        {tab === 'enterprise' ? (
          <ListHead title="本企业经验" search={[q, setQ]} placeholder="名称、用途或标签">
            {scopeSelect}
            <select aria-label="经验状态" disabled={locked} value={contentState} onChange={(e) => setContentState(e.target.value)}>
              <option value="AVAILABLE">当前可用</option>
              <option value="STOPPED">已停用</option>
            </select>
          </ListHead>
        ) : (
          <ListHead title="处理记录">
            {scopeSelect}
            <select aria-label="处理状态" disabled={locked} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="ALL">全部状态</option>
              {Object.entries(processingLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <button type="button" className="icon" title="刷新" aria-label="刷新" disabled={locked} onClick={refresh}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" />
              </svg>
            </button>
          </ListHead>
        )}
        <div className="card-scroll">
          {tab === 'enterprise' ? (
            <ListBody remote={contents} empty="当前范围内没有经验。来源受限或尚未通过核验的内容不会显示在可用列表中。">
              {(rows) =>
                rows.map(({ experience: e, workspaceId, workspaceName, updatedAt }) => (
                  <KnowledgeListRow
                    key={e.id}
                    name={e.title}
                    summary={`${workspaceName} · v${e.number} · ${e.origin === 'AUTOMATIC' ? '系统积累 · 自动核验通过' : '历史人工经验 · 未评测'}`}
                    side={e.status === 'PUBLISHED' ? stamp(updatedAt) : '已停用'}
                    tone={e.status === 'PUBLISHED' ? 'ok' : 'plain'}
                    selected={e.id === detailId}
                    onSelect={() => !locked && open(e.id, workspaceId, e.versionId)}
                  />
                ))
              }
            </ListBody>
          ) : (
            <ListBody remote={processing} empty="暂无处理记录。任务和用户反馈会在自动积累启用后按规则进入处理。">
              {(rows) =>
                rows.map((r) => (
                  <KnowledgeListRow
                    key={r.id}
                    name={SOURCE[r.sourceKind]}
                    summary={r.reason ? reasonLabels[r.reason] || r.reason : r.state === 'UNAVAILABLE' ? '来源当前不可用' : '按当前来源和适用条件处理'}
                    side={processingLabels[r.state]}
                    tone={tone(r.state)}
                    selected={r.id === record?.id}
                    onSelect={() => !locked && write({ item: r.id })}
                  />
                ))
              }
            </ListBody>
          )}
        </div>
      </article>

      <article className="card detail" aria-live="polite">
        {tab === 'processing' && record && !record.entryId ? (
          <>
            <header>
              <h2>{SOURCE[record.sourceKind]}</h2>
              <span>{stamp(record.updatedAt)}</span>
            </header>
            <div className="card-scroll">
              <p className={`verdict tone-${tone(record.state)}`}>{processingLabels[record.state]}</p>
              <p className="note">
                {record.reason
                  ? reasonLabels[record.reason] || record.reason
                  : record.state === 'UNAVAILABLE'
                    ? '来源当前不可用，相关经验按依赖规则停止使用。'
                    : '系统按当前来源和适用条件处理。'}
              </p>
              <p className="note">这条处理记录没有关联的经验条目。</p>
            </div>
          </>
        ) : detailId && detailSpace ? (
          <>
            {tab === 'processing' && record && (
              <header>
                <h2>{SOURCE[record.sourceKind]}</h2>
                <span>
                  {processingLabels[record.state]} · {stamp(record.updatedAt)} · 下方是关联经验
                </span>
              </header>
            )}
            <div className="card-scroll legacy-skin">
              <ExperienceDrawer
                key={detailId + ':' + detailVersion}
                inline
                tenant={tenant}
                selection={{ id: detailId, space: detailSpace, version: detailVersion }}
                close={() => write({ item: null, space: null, version: null })}
                changed={refresh}
                lock={setLocked}
                chooseVersion={(v) => write({ version: v })}
              />
            </div>
          </>
        ) : (
          <header>
            <h2>{tab === 'enterprise' ? '没有可查看的经验' : '没有可查看的记录'}</h2>
          </header>
        )}
      </article>

      <div className="side">
        {tab === 'processing' && meta ? (
          <Facts
            title={meta.enabled ? '自动积累 · 每 30 秒更新' : '自动积累尚未启用'}
            rows={[
              ['等待处理', meta.counts.WAITING],
              ['正在处理', meta.counts.PROCESSING + meta.counts.RETRYING],
              ['入库与更新', meta.counts.ADMITTED + meta.counts.UPDATED],
              ['无新增', meta.counts.DUPLICATE],
              ['未入库', meta.counts.NOT_ADMITTED],
              ['执行未完成', meta.counts.FAILED + meta.counts.UNKNOWN],
              ['来源已失效', meta.counts.UNAVAILABLE],
            ]}
          />
        ) : (
          <Facts
            title="当前清单"
            rows={[
              ['经验范围', space ? scopes.find((s) => s.id === space)?.name || '所选空间' : '全部获权空间'],
              ['状态', contentState === 'AVAILABLE' ? '当前可用' : '已停用'],
              ['已列出', contents.value ? `${items.length}${contents.value.more ? '+' : ''}` : undefined],
            ]}
          />
        )}
        <article className="card facts more">
          <header>
            <h2>说明</h2>
          </header>
          <div className="fact line">
            <span>
              {tab === 'processing'
                ? '统计当前范围内已登记的来源处理结果；入库次数不代表当前经验数量或质量。本页无需人工审核。'
                : '本企业当前获权经验。方法供引擎按需参考，自动核验通过不代表所有场景都适用。'}
            </span>
          </div>
        </article>
      </div>
    </section>
  );
}
