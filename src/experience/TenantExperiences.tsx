import { useEffect, useState, type ReactNode } from 'react';
import { BookOpen, RefreshCw } from 'lucide-react';
import { IdentityError, uuid } from '../identity/client';
import { useSession } from '../identity/session';
import { Badge, Button, DocumentText, Empty, Field, Modal, PageActions } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { pageState, textState, useViewState } from '../shared/useViewState';
import { requestNavigationLocked, useRequestLock } from '../shared/request-guard';
import { experienceClient } from './client';
import { experienceManagementClient as api, processingLabels, reasonLabels } from './management-client';
import './management.css';
import { GeneralExperienceLibrary } from './GeneralExperienceLibrary';
import type { LocalExperienceSelection } from './GeneralSuggestionPanel';
import { ExperienceAdjustmentPanel } from './ExperienceAdjustmentPanel';
const stamp = (date: string) => new Date(date).toLocaleString('zh-CN', { hour12: false });
export type Selection = { id: string; version: string | null; space: string };
const isSelection = (v: unknown): v is Selection | null =>
  v === null ||
  (!!v &&
    typeof v === 'object' &&
    'id' in v &&
    'version' in v &&
    'space' in v &&
    uuid(v.id) &&
    (v.version === null || uuid(v.version)) &&
    uuid(v.space));
export function TenantExperiences({ tenant }: { tenant: string }) {
  const [source, setSource] = useViewState(
    tenant,
    'experience:source',
    'enterprise',
    (v): v is string => v === 'enterprise' || v === 'general',
  );
  const [tab, setTab] = useViewState(
    tenant,
    'experience:tab',
    'content',
    (v): v is string => v === 'content' || v === 'processing',
  );
  const [locked, setLocked] = useState(false);
  const [localSelection, setLocalSelection] = useState<LocalExperienceSelection | null>(null);
  const params = new URLSearchParams(location.hash.slice(1));
  const linkedEntry =
    uuid(params.get('experience')) && uuid(params.get('scope')) ? params.get('experience') : null;
  useEffect(() => {
    if (linkedEntry) {
      setSource('enterprise');
      setTab('content');
    }
  }, [tenant, linkedEntry, setSource, setTab]);
  return (
    <div className="admin-dashboard tenant-experience-page">
      <nav className="platform-detail-nav" aria-label="经验库栏目">
        {(
          [
            ['enterprise', '企业经验'],
            ['general', '通用经验'],
            ['processing', '积累与改进'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant="ghost"
            aria-current={
              (
                source === 'general'
                  ? key === 'general'
                  : tab === 'processing'
                    ? key === 'processing'
                    : key === 'enterprise'
              )
                ? 'page'
                : undefined
            }
            disabled={locked}
            onClick={() => {
              if (!requestNavigationLocked()) {
                setLocalSelection(null);
                setSource(key === 'general' ? 'general' : 'enterprise');
                setTab(key === 'processing' ? 'processing' : 'content');
              }
            }}
          >
            {label}
          </Button>
        ))}
      </nav>
      <section className="tenant-experience-content">
        {source === 'general' ? (
          <GeneralExperienceLibrary
            tenant={tenant}
            onLocked={setLocked}
            chooseLocal={(selection) => {
              setLocalSelection(selection);
              setSource('enterprise');
              setTab('content');
            }}
          />
        ) : (
          <EnterpriseExperiences
            tenant={tenant}
            tab={tab}
            onLocked={setLocked}
            initialSelection={localSelection}
          />
        )}
      </section>
    </div>
  );
}
function EnterpriseExperiences({
  tenant,
  tab,
  onLocked,
  initialSelection,
}: {
  tenant: string;
  tab: string;
  onLocked: (value: boolean) => void;
  initialSelection?: LocalExperienceSelection | null;
}) {
  const { session } = useSession();
  const params = new URLSearchParams(location.hash.slice(1));
  const legacySpace = uuid(params.get('scope')) ? params.get('scope')! : '';
  const legacyEntry =
    uuid(params.get('experience')) && legacySpace
      ? { id: params.get('experience')!, version: null, space: legacySpace }
      : null;
  const [space, setSpace] = useViewState(
    tenant,
    'experience:scope',
    legacySpace,
    (v): v is string => v === '' || uuid(v),
  );
  const [query, setQuery] = useViewState(tenant, 'experience:query', '', textState),
    [input, setInput] = useState(query);
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
  const [contentPage, setContentPage] = useViewState(tenant, 'experience:content-page', 0, pageState),
    [processingPage, setProcessingPage] = useViewState(tenant, 'experience:processing-page', 0, pageState);
  const [selection, select] = useViewState<Selection | null>(
    tenant,
    'experience:selection',
    legacyEntry,
    isSelection,
  );
  useEffect(() => {
    if (legacyEntry) {
      setSpace(legacySpace);
      select(legacyEntry);
    }
  }, [legacyEntry?.id, legacySpace, setSpace, select]);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    onLocked(locked);
    return () => onLocked(false);
  }, [locked, onLocked]);
  useEffect(() => {
    if (initialSelection) select(initialSelection);
  }, [initialSelection, select]);
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((n) => n + 1);
  const data = useRemote(
    (signal) => api.contents(tenant, space, query, contentState, contentPage * 20, signal),
    [tenant, space, query, contentState, contentPage, attempt, session.identity],
  );
  const processing = useRemote(
    (signal) =>
      tab === 'processing'
        ? api.processing(tenant, space, state, processingPage * 20, signal)
        : Promise.resolve(null),
    [tenant, space, state, processingPage, attempt, tab, session.identity],
  );
  useEffect(() => {
    if (tab !== 'processing' || selection) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !requestNavigationLocked()) setAttempt((n) => n + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, [tab, selection]);
  const scopes = data.value?.scopes || processing.value?.scopes || [];
  const error = data.error || processing.error;
  useEffect(() => {
    if (error) select(null);
  }, [error, select]);
  return (
    <div className="admin-dashboard experience-management">
      <PageActions>
        <Button icon={RefreshCw} variant="ghost" disabled={locked} onClick={refresh}>
          刷新
        </Button>
      </PageActions>
      <form
        className="experience-management-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(input);
          setContentPage(0);
        }}
      >
        <Field label="经验范围">
          <select
            disabled={locked}
            aria-label="经验范围"
            value={space}
            onChange={(e) => {
              setSpace(e.target.value);
              setContentPage(0);
              setProcessingPage(0);
              select(null);
            }}
          >
            <option value="">全部获权空间</option>
            {scopes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {tab === 'processing' ? (
          <Field label="处理状态">
            <select
              disabled={locked}
              aria-label="处理状态"
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setProcessingPage(0);
              }}
            >
              <option value="ALL">全部状态</option>
              {Object.entries(processingLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <>
            <Field label="搜索经验">
              <input
                disabled={locked}
                aria-label="搜索经验"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="名称、用途或标签"
                maxLength={200}
              />
            </Field>
            <Field label="状态">
              <select
                disabled={locked}
                aria-label="经验状态"
                value={contentState}
                onChange={(e) => {
                  setContentState(e.target.value);
                  setContentPage(0);
                }}
              >
                <option value="AVAILABLE">当前可用</option>
                <option value="STOPPED">已停用</option>
              </select>
            </Field>
            <Button type="submit" disabled={locked}>
              搜索
            </Button>
          </>
        )}
      </form>
      {error ? (
        <Failure
          error={error}
          retry={() => {
            setSpace('');
            refresh();
          }}
        />
      ) : tab === 'processing' ? (
        !processing.value ? (
          <Loading />
        ) : (
          <>
            <p className="muted">
              {processing.value.enabled
                ? '系统自动处理，每 30 秒更新状态。'
                : '自动积累尚未启用，以下保留已有处理记录。'}{' '}
              本页无需人工审核。
            </p>
            <div className="experience-processing-metrics">
              {(
                [
                  ['等待处理', processing.value.counts.WAITING],
                  ['正在处理', processing.value.counts.PROCESSING + processing.value.counts.RETRYING],
                  ['入库与更新', processing.value.counts.ADMITTED + processing.value.counts.UPDATED],
                  ['无新增', processing.value.counts.DUPLICATE],
                  ['未入库', processing.value.counts.NOT_ADMITTED],
                  ['执行未完成', processing.value.counts.FAILED + processing.value.counts.UNKNOWN],
                ] as const
              ).map(([label, count]) => (
                <section className="admin-section" key={label}>
                  <span>{label}</span>
                  <strong>{count}</strong>
                </section>
              ))}
            </div>
            <p className="muted">
              统计当前范围内已登记的来源处理结果；入库次数不代表当前经验数量或质量。来源已失效：
              {processing.value.counts.UNAVAILABLE}。
            </p>
            {processing.value.items.length ? (
              <div className="experience-processing-list">
                {processing.value.items.map((item) => (
                  <article key={item.id} className="admin-section">
                    <div>
                      <strong>
                        {item.sourceKind === 'GENERAL_SUGGESTION'
                          ? '通用经验补充与反馈'
                          : item.sourceKind === 'ADJUSTMENT'
                            ? '经验内容调整'
                            : item.sourceKind === 'FEEDBACK'
                              ? '反馈关联内容'
                              : '任务执行结果'}
                      </strong>
                      <Badge>{processingLabels[item.state]}</Badge>
                    </div>
                    <p>
                      {item.reason
                        ? reasonLabels[item.reason]
                        : item.state === 'UNAVAILABLE'
                          ? '来源当前不可用，相关经验按依赖规则停止使用。'
                          : '系统按当前来源和适用条件处理。'}
                    </p>
                    <footer>
                      <time>{stamp(item.updatedAt)}</time>
                      {item.entryId && item.versionId && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            select({ id: item.entryId!, version: item.versionId!, space: item.workspaceId })
                          }
                        >
                          查看关联经验
                        </Button>
                      )}
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                icon={BookOpen}
                title="暂无处理记录"
                text="任务和用户反馈会在自动积累启用后按规则进入处理。"
              />
            )}
            <Pager page={processingPage} next={processing.value.hasMore} onPage={setProcessingPage} />
          </>
        )
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <p className="muted">本企业当前获权经验。方法供引擎按需参考，自动核验通过不代表所有场景都适用。</p>
          {data.value.items.length ? (
            <div className="tenant-directory-scroll tenant-experience-directory">
              <div className="tenant-list-columns tenant-experience-grid">
                <span>经验名称</span>
                <span>所属空间 / 版本</span>
                <span>状态</span>
                <span>更新于</span>
              </div>
              <div className="experience-management-list">
                {data.value.items.map(({ experience: e, workspaceId, workspaceName, updatedAt }) => (
                  <button
                    className="experience-management-card tenant-experience-grid"
                    key={e.id}
                    onClick={() => select({ id: e.id, version: e.versionId, space: workspaceId })}
                  >
                    <span className="tenant-experience-name">
                      <strong>{e.title}</strong>
                      <small>{e.summary}</small>
                    </span>
                    <span>
                      {workspaceName}
                      <small>
                        v{e.number} ·{' '}
                        {e.origin === 'AUTOMATIC' ? '系统积累 · 自动核验通过' : '历史人工经验 · 未评测'}
                      </small>
                    </span>
                    <span>
                      <Badge>{e.status === 'PUBLISHED' ? '可用' : '已停用'}</Badge>
                    </span>
                    <time>{stamp(updatedAt)}</time>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Empty
              icon={BookOpen}
              title="当前范围内没有经验"
              text="你可以调整筛选；来源受限或尚未通过核验的内容不会显示在可用列表中。"
            />
          )}
          <Pager page={contentPage} next={data.value.hasMore} onPage={setContentPage} />
        </>
      )}
      {selection && !error && (
        <ExperienceDrawer
          tenant={tenant}
          selection={selection}
          close={() => {
            if (!locked) select(null);
          }}
          changed={refresh}
          lock={setLocked}
          chooseVersion={(version) => select({ ...selection, version })}
        />
      )}
    </div>
  );
}
/** 经验详情：管理台里以弹窗打开；企业管理端的经验库把它直接放进详情卡（inline）。 */
export function ExperienceDrawer({
  tenant,
  selection,
  close,
  chooseVersion,
  changed,
  lock,
  inline = false,
}: {
  tenant: string;
  selection: Selection;
  close: () => void;
  chooseVersion: (version: string) => void;
  changed: () => void;
  lock: (value: boolean) => void;
  inline?: boolean;
}) {
  type Action = { intent: 'stop' | 'restore'; expectedRevision: number; versionId: string };
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState('');
  const [adjusting, setAdjusting] = useState(false),
    [adjustmentBlocked, setAdjustmentBlocked] = useState(false);
  const submission = useSubmission<Action>();
  const blocked = submission.busy || submission.uncertain || adjustmentBlocked;
  useRequestLock(blocked);
  useEffect(() => {
    lock(blocked);
    return () => lock(false);
  }, [blocked, lock]);
  const [attempt, setAttempt] = useState(0),
    [historyOpen, setHistoryOpen] = useState(false),
    [historyPage, setHistoryPage] = useState(0);
  const detail = useRemote(
    (signal) =>
      experienceClient.get(tenant, selection.space, selection.id, selection.version || undefined, signal),
    [tenant, selection.space, selection.id, selection.version, attempt],
  );
  const history = useRemote(
    (signal) =>
      historyOpen
        ? api.history(tenant, selection.space, selection.id, historyPage * 20, signal)
        : Promise.resolve(null),
    [tenant, selection.space, selection.id, historyOpen, historyPage, attempt],
  );
  const e = detail.value,
    c = e?.version.content;
  const [referencePage, setReferencePage] = useState(0);
  useEffect(() => setReferencePage(0), [selection.id, selection.version]);
  const references = useRemote(
    (signal) =>
      e
        ? api.generalReferences(
            tenant,
            selection.space,
            selection.id,
            e.version.id,
            referencePage * 20,
            signal,
          )
        : Promise.resolve(null),
    [tenant, selection.space, selection.id, e?.version.id, referencePage, attempt],
  );
  const referenceDenied =
    references.error instanceof IdentityError && [401, 403, 404].includes(references.error.status)
      ? references.error
      : undefined;
  const denied =
    detail.error ||
    history.error ||
    referenceDenied ||
    (submission.error instanceof IdentityError && [401, 403, 404].includes(submission.error.status)
      ? submission.error
      : undefined);
  return (
    <DrawerShell
      inline={inline}
      onClose={() => {
        if (!blocked) close();
      }}
    >
      {notice && <p role="status">{notice}</p>}
      {denied ? (
        <Failure error={denied} retry={() => setAttempt((n) => n + 1)} />
      ) : !e || !c ? (
        <Loading />
      ) : (
        <article className="experience-detail">
          <div className="experience-section-head">
            <h3>{c.title}</h3>
            <Badge>
              v{e.version.number} ·{' '}
              {e.status === 'WITHDRAWN'
                ? '已停用'
                : e.publishedVersion === e.version.id
                  ? references.value?.canReference
                    ? '当前可用'
                    : references.value
                      ? '暂停参考'
                      : '当前版本'
                  : '历史版本'}
            </Badge>
          </div>
          {e.canMaintain &&
            e.version.origin === 'AUTOMATIC' &&
            !adjusting &&
            ((e.status === 'PUBLISHED' && e.publishedVersion === e.version.id) || e.canRestore || action) && (
              <section className="experience-availability" aria-label="经验使用状态">
                {action ? (
                  <>
                    <p>
                      {action.intent === 'stop'
                        ? '停用后，引擎不再检索采用此经验，自动更新暂停；依赖它的自动经验会失效。历史版本保留。'
                        : '恢复最后发布版本供后续任务参考，并允许系统继续自动更新；已清理的内容和下游任务不会恢复。'}
                    </p>
                    <SubmitError error={submission.error} uncertain={submission.uncertain} />
                    <Button
                      disabled={submission.busy}
                      onClick={() =>
                        void submission.submit(action, async (body, requestId) => {
                          if (body.intent === 'stop')
                            await experienceClient.stop(tenant, selection.space, selection.id, {
                              requestId,
                              expectedRevision: body.expectedRevision,
                              versionId: body.versionId,
                            });
                          else
                            await experienceClient.restore(tenant, selection.space, selection.id, {
                              requestId,
                              expectedRevision: body.expectedRevision,
                              versionId: body.versionId,
                            });
                          setNotice(body.intent === 'stop' ? '经验已停用。' : '经验已恢复使用。');
                          setAction(null);
                          setAttempt((n) => n + 1);
                          changed();
                        })
                      }
                    >
                      {submission.busy
                        ? '正在提交…'
                        : submission.uncertain
                          ? '重试原请求'
                          : action.intent === 'stop'
                            ? '确认停用'
                            : '确认恢复'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={blocked}
                      onClick={() => {
                        setAction(null);
                        setAttempt((n) => n + 1);
                      }}
                    >
                      取消并刷新
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setAction({
                        intent: e.status === 'PUBLISHED' ? 'stop' : 'restore',
                        expectedRevision: e.revision,
                        versionId: e.version.id,
                      })
                    }
                  >
                    {e.status === 'PUBLISHED' ? '停用经验' : '恢复使用'}
                  </Button>
                )}
              </section>
            )}
          <p className="experience-detail-meta">
            {e.version.origin === 'AUTOMATIC'
              ? '系统积累 · 自动核验通过'
              : '历史人工经验 · 未自动核验，仅供查看'}{' '}
            · {stamp(e.version.createdAt)}
          </p>
          {references.error && !referenceDenied ? (
            <fieldset className="general-experience-control-group" disabled={blocked || adjusting}>
              <Failure error={references.error} retry={() => setAttempt((n) => n + 1)} />
            </fieldset>
          ) : references.value && (references.value.items.length > 0 || references.value.hasMore) ? (
            <section className="experience-general-references" aria-label="引用的通用经验">
              <h3>引用的通用经验</h3>
              <p className="muted">保留形成当前企业版本时的通用版本，后续总库更新不会自动覆盖企业内容。</p>
              {e.status === 'PUBLISHED' &&
                e.publishedVersion === e.version.id &&
                !references.value.canReference && (
                  <p role="status">引用的通用经验已停用，当前企业版本暂停供引擎参考。</p>
                )}
              {references.value.items.map((item) => (
                <div className="experience-reference-row" key={item.versionId}>
                  <strong>
                    {item.title} · v{item.number}
                  </strong>
                  <Badge>
                    {item.useState === 'GLOBAL_STOPPED'
                      ? '总库已停用'
                      : item.useState === 'TENANT_STOPPED'
                        ? '本企业已停用'
                        : '可供参考'}
                  </Badge>
                  <p className="muted">
                    {item.current ? '引用的是总库当前版本。' : '总库已有新版，本经验继续引用此固定版本。'}
                  </p>
                </div>
              ))}
              {(referencePage > 0 || references.value.hasMore) && (
                <fieldset className="general-experience-control-group" disabled={blocked || adjusting}>
                  <Pager page={referencePage} next={references.value.hasMore} onPage={setReferencePage} />
                </fieldset>
              )}
            </section>
          ) : null}
          <p>{c.summary}</p>
          <div className="experience-management-tags">
            {c.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
          {e.canMaintain &&
            c.kind === 'METHOD' &&
            !action &&
            (references.value?.canReference || (!references.value && (adjusting || adjustmentBlocked))) && (
              <ExperienceAdjustmentPanel
                tenant={tenant}
                space={selection.space}
                entry={e}
                editing={setAdjusting}
                locked={setAdjustmentBlocked}
                chooseVersion={chooseVersion}
                changed={() => {
                  setAttempt((n) => n + 1);
                  changed();
                }}
              />
            )}
          <details open>
            <summary>方法与适用条件</summary>
            <DocumentText text={c.body} />
            <h4>适用条件</h4>
            <p>{c.applicable}</p>
            <h4>不适用与限制</h4>
            <p>{c.excluded || '未提供额外限制，使用前仍需核对当前条件。'}</p>
          </details>
          <details>
            <summary>依据与依赖</summary>
            <p>{c.basis}</p>
            <p>{c.dependencies || '使用前核对当前获准来源和工具。'}</p>
            <p>{c.accessMode === 'SOURCE_BOUND' ? '持续依赖来源权限' : '独立内容版本'}</p>
            <ul className="experience-refs">
              {e.version.evidence.map((ref) => (
                <li key={ref.kind + ref.referenceId}>
                  {ref.kind === 'TASK' ? '任务依据' : '固定资料版本'} · {ref.referenceId}
                </li>
              ))}
            </ul>
          </details>
          <details onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
            <summary>版本历史</summary>
            {historyOpen &&
              (!history.value ? (
                <Loading />
              ) : (
                <>
                  <ul className="experience-management-history">
                    {history.value.items.map((v) => (
                      <li key={v.id}>
                        <Button
                          variant="ghost"
                          disabled={blocked || adjusting || !!action || selection.version === v.id}
                          onClick={() => chooseVersion(v.id)}
                        >
                          v{v.number}
                          {v.current ? ' · 当前生效' : ''}
                        </Button>
                        <time>{stamp(v.createdAt)}</time>
                      </li>
                    ))}
                  </ul>
                  <Pager page={historyPage} next={history.value.hasMore} onPage={setHistoryPage} />
                </>
              ))}
          </details>
        </article>
      )}
    </DrawerShell>
  );
}
function DrawerShell({ inline, onClose, children }: { inline: boolean; onClose: () => void; children: ReactNode }) {
  return inline ? (
    <div className="experience-inline">{children}</div>
  ) : (
    <Modal title="经验详情" className="experience-management-drawer" onClose={onClose}>
      {children}
    </Modal>
  );
}
