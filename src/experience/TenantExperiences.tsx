import { useEffect, useState } from 'react';
import { BookOpen, RefreshCw } from 'lucide-react';
import { uuid } from '../identity/client';
import { useSession } from '../identity/session';
import { Badge, Button, DocumentText, Empty, Field, Modal } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { pageState, textState, useViewState } from '../shared/useViewState';
import { requestNavigationLocked } from '../shared/request-guard';
import { experienceClient } from './client';
import { experienceManagementClient as api, processingLabels, reasonLabels } from './management-client';
import './management.css';
const stamp = (date: string) => new Date(date).toLocaleString('zh-CN', { hour12: false });
type Selection = { id: string; version: string | null; space: string };
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
  const { session } = useSession();
  const params = new URLSearchParams(location.hash.slice(1));
  const legacySpace = uuid(params.get('scope')) ? params.get('scope')! : '';
  const legacyEntry =
    uuid(params.get('experience')) && legacySpace
      ? { id: params.get('experience')!, version: null, space: legacySpace }
      : null;
  const [tab, setTab] = useViewState(
    tenant,
    'experience:tab',
    'content',
    (v): v is string => v === 'content' || v === 'processing',
  );
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
      <div className="experience-management-tabs" role="tablist" aria-label="经验库板块">
        <Button
          role="tab"
          aria-selected={tab !== 'processing'}
          variant={tab !== 'processing' ? 'primary' : 'ghost'}
          onClick={() => setTab('content')}
        >
          经验内容
        </Button>
        <Button
          role="tab"
          aria-selected={tab === 'processing'}
          variant={tab === 'processing' ? 'primary' : 'ghost'}
          onClick={() => setTab('processing')}
        >
          积累与改进
        </Button>
        <Button icon={RefreshCw} variant="ghost" onClick={refresh}>
          刷新
        </Button>
      </div>
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
                aria-label="搜索经验"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="名称、用途或标签"
                maxLength={200}
              />
            </Field>
            <Field label="状态">
              <select
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
            <Button type="submit">搜索</Button>
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
                      <strong>{item.sourceKind === 'FEEDBACK' ? '反馈关联内容' : '任务执行结果'}</strong>
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
            <div className="experience-management-list">
              {data.value.items.map(({ experience: e, workspaceId, workspaceName, updatedAt }) => (
                <button
                  className="experience-management-card"
                  key={e.id}
                  onClick={() => select({ id: e.id, version: e.versionId, space: workspaceId })}
                >
                  <div>
                    <Badge>{e.status === 'PUBLISHED' ? '可用' : '已停用'}</Badge>
                    <small>
                      {workspaceName} · v{e.number}
                    </small>
                  </div>
                  <h2>{e.title}</h2>
                  <p>{e.summary}</p>
                  <footer>
                    <span>
                      {e.origin === 'AUTOMATIC' ? '系统积累 · 自动核验通过' : '历史人工经验 · 未评测'}
                    </span>
                    <time>{stamp(updatedAt)}</time>
                  </footer>
                </button>
              ))}
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
          close={() => select(null)}
          chooseVersion={(version) => select({ ...selection, version })}
        />
      )}
    </div>
  );
}
function ExperienceDrawer({
  tenant,
  selection,
  close,
  chooseVersion,
}: {
  tenant: string;
  selection: Selection;
  close: () => void;
  chooseVersion: (version: string) => void;
}) {
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
  const denied = detail.error || history.error;
  return (
    <Modal title="经验详情" className="experience-management-drawer" onClose={close}>
      {denied ? (
        <Failure error={denied} retry={() => setAttempt((n) => n + 1)} />
      ) : !e || !c ? (
        <Loading />
      ) : (
        <article className="experience-detail">
          <div className="experience-section-head">
            <h3>{c.title}</h3>
            <Badge>
              v{e.version.number} · {e.publishedVersion === e.version.id ? '当前可用' : '历史版本'}
            </Badge>
          </div>
          <p className="experience-detail-meta">
            {e.version.origin === 'AUTOMATIC' ? '系统积累 · 自动核验通过' : '历史人工经验 · 未评测'} ·{' '}
            {stamp(e.version.createdAt)}
          </p>
          <p>{c.summary}</p>
          <div className="experience-management-tags">
            {c.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
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
                          disabled={selection.version === v.id}
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
    </Modal>
  );
}
