import { useCallback, useContext, useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Plus, RefreshCw } from 'lucide-react';
import type { ExperienceContent, ExperienceEntry } from '../../contracts/public-api/experience';
import { useSession } from '../identity/session';
import { IdentityError } from '../identity/client';
import { Badge, Button, DocumentText, Empty, Field } from '../shared/ui';
import {
  Failure,
  Loading,
  MutationGate,
  Pager,
  SubmitError,
  useRemote,
  useSubmission,
} from '../shared/admin';
import { experienceClient as api } from './client';
import { ExperienceEditor } from './ExperienceEditor';
import { ExperienceUsePanel } from './ExperienceUsePanel';
import { experienceSeeds } from './seeds';
import './experience.css';
import { useRequestLock } from '../shared/request-guard';
import { ExperienceBusyContext, ExperienceGuardContext, useExperienceGuard } from './useExperienceGuard';
const states = { CANDIDATE: '候选', PUBLISHED: '已发布', WITHDRAWN: '已撤回' };
export interface ExperienceLibraryProps {
  tenant: string;
  workspace: string;
  workspaceName: string;
  verification?: unknown;
  initialExperience?: string;
  readOnly?: boolean;
}
/** Both employee and tenant maintenance surfaces render this component against the identical workspace object. */
export function ExperienceLibrary(props: ExperienceLibraryProps) {
  const { session } = useSession();
  return session.identity ? (
    <Library key={`${session.identity.account.id}:${props.tenant}:${props.workspace}`} {...props} />
  ) : null;
}
function Library({ tenant, workspace, workspaceName, verification, initialExperience, readOnly = false }: ExperienceLibraryProps) {
  const outerGate = useContext(MutationGate);
  const [busy, setBusy] = useState(false);
  const [locks, setLocks] = useState<ReadonlySet<string>>(new Set());
  const blocked = busy || locks.size > 0;
  useRequestLock(blocked);
  const guard = useCallback((id: string, value: boolean) => {
    setLocks((current) => {
      if (current.has(id) === value) return current;
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  useEffect(() => {
    outerGate(blocked);
    return () => outerGate(false);
  }, [blocked, outerGate]);
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0),
    [maintenance, setMaintenance] = useState(false),
    [page, setPage] = useState(0),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [tag, setTag] = useState(''),
    [selected, setSelected] = useState<{ id: string; version?: string }>(),
    [editor, setEditor] = useState<{ entry?: ExperienceEntry; seed?: ExperienceContent }>(),
    [denial, setDenial] = useState<unknown>();
  const refresh = useCallback(() => {
    setDenial(undefined);
    setAttempt((n) => n + 1);
  }, []);
  useEffect(() => {
    const focus = () => {
      if (!blocked) refresh();
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh, blocked]);
  useEffect(() => {
    setEditor(undefined);
    setSelected(initialExperience ? { id: initialExperience } : undefined);
    setDenial(undefined);
  }, [verification, session.identity, initialExperience]);
  const onDenied = useCallback((e: unknown) => {
    if (e instanceof IdentityError && [401, 403, 404].includes(e.status)) {
      setEditor(undefined);
      setSelected(undefined);
      setDenial(e);
    }
  }, []);
  const list = useRemote(
    (signal) => api.list(tenant, workspace, query, tag, maintenance, page * 20, signal),
    [tenant, workspace, query, tag, maintenance, page, attempt, verification, session.identity],
  );
  const detail = useRemote(
    (signal) =>
      selected ? api.get(tenant, workspace, selected.id, selected.version, signal) : Promise.resolve(null),
    [tenant, workspace, selected?.id, selected?.version, attempt, verification, session.identity],
  );
  const saved = (e: ExperienceEntry) => {
    setEditor(undefined);
    setSelected({ id: e.id, version: e.version.id });
    refresh();
  };
  if (denial || list.error)
    return (
      <Failure
        error={denial || list.error}
        retry={() => {
          setMaintenance(false);
          setSelected(undefined);
          setEditor(undefined);
          refresh();
        }}
      />
    );
  if (!list.value) return <Loading />;
  return (
    <MutationGate.Provider value={setBusy}>
      <ExperienceGuardContext.Provider value={guard}>
        <ExperienceBusyContext.Provider value={blocked}>
          <section className="experience-library">
            <header className="experience-header">
              <div>
                <span className="experience-eyebrow">可复用方法 · {workspaceName}</span>
                <h2>经验库</h2>
                <p>按需找方法，结合本次资料判断。方法参考与执行结果分别保留。</p>
              </div>
              <div className="experience-actions">
                <Button
                  disabled={blocked}
                  icon={RefreshCw}
                  onClick={() => {
                    setEditor(undefined);
                    refresh();
                  }}
                >
                  刷新
                </Button>
                {!readOnly && list.value.canMaintain && (
                  <Button
                    disabled={blocked}
                    variant="primary"
                    icon={Plus}
                    onClick={() => {
                      setSelected(undefined);
                      setEditor({});
                    }}
                  >
                    整理经验
                  </Button>
                )}
              </div>
            </header>
            {editor ? (
              <ExperienceEditor
                key={editor.entry?.version.id || editor.seed?.title || 'new'}
                tenant={tenant}
                workspace={workspace}
                entry={editor.entry}
                seed={editor.seed}
                saved={saved}
                cancel={() => setEditor(undefined)}
                onDenied={onDenied}
              />
            ) : selected ? (
              <>
                <Button disabled={blocked} icon={ArrowLeft} onClick={() => setSelected(undefined)}>
                  返回经验列表
                </Button>
                {detail.error ? (
                  <Failure
                    error={detail.error}
                    retry={() => {
                      setSelected(undefined);
                      refresh();
                    }}
                  />
                ) : !detail.value ? (
                  <Loading />
                ) : (
                  <ExperienceDetail
                    key={`${detail.value.id}:${detail.value.version.id}:${detail.value.revision}`}
                    tenant={tenant}
                    workspace={workspace}
                    entry={readOnly ? { ...detail.value, canMaintain: false } : detail.value}
                    changed={saved}
                    edit={() => setEditor({ entry: detail.value! })}
                    chooseVersion={(version) => setSelected({ id: selected.id, version })}
                    onDenied={onDenied}
                  />
                )}
              </>
            ) : (
              <>
                <form
                  className="experience-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setQuery(search);
                    setPage(0);
                  }}
                >
                  <Field label="检索方法">
                    <input
                      placeholder="问题、方法、关键业务词"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      maxLength={200}
                    />
                  </Field>
                  <Field label="标签筛选">
                    <input
                      value={tag}
                      maxLength={40}
                      onChange={(e) => {
                        setTag(e.target.value);
                        setPage(0);
                      }}
                      placeholder="完整标签"
                    />
                  </Field>
                  <Button type="submit">检索</Button>
                  {!readOnly && list.value.canMaintain && (
                    <label className="experience-checkbox">
                      <input
                        type="checkbox"
                        checked={maintenance}
                        onChange={(e) => {
                          setMaintenance(e.target.checked);
                          setPage(0);
                        }}
                      />
                      维护视图（候选 / 生效 / 撤回）
                    </label>
                  )}
                </form>
                <p className="experience-note">
                  关键词与标签检索 · 索引已就绪 · 手工整理，尚未评测。
                  {maintenance ? '修改候选不会自动替换当前生效版本。' : '这里只显示当前可读取的生效版本。'}
                </p>
                {list.value.items.length ? (
                  <div className="experience-grid">
                    {list.value.items.map((item) => (
                      <button
                        className="experience-card"
                        key={item.id}
                        onClick={() => setSelected({ id: item.id, version: item.versionId })}
                      >
                        <div>
                          <Badge>{states[item.status]}</Badge>
                          <span>v{item.number} · 未评测</span>
                        </div>
                        <h3>{item.title}</h3>
                        <p>{item.summary}</p>
                        <small>适用：{item.applicable}</small>
                        {item.excluded && <small>不适用：{item.excluded}</small>}
                        <footer>
                          {item.tags.map((t) => (
                            <span key={t}>#{t}</span>
                          ))}
                        </footer>
                      </button>
                    ))}
                  </div>
                ) : (
                  <Empty
                    icon={BookOpen}
                    title={query || tag ? '当前范围内没有匹配经验' : '还没有可用经验'}
                    text="你可以继续原工作。候选需要明确发布，来源受限或已撤回的经验不会混入结果。"
                  />
                )}
                <Pager page={page} next={list.value.hasMore} onPage={setPage} />
                {!readOnly && list.value.canMaintain && (
                  <section className="experience-seeds">
                    <h3>可选的起步方法</h3>
                    <p>
                      以下由开发版人工编写，未关联真实成功案例、未评测。选择后先编辑为候选，再自行决定是否发布。
                    </p>
                    <div className="experience-actions">
                      {experienceSeeds.map((seed) => (
                        <Button key={seed.title} onClick={() => setEditor({ seed })}>
                          {seed.title}
                        </Button>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </section>
        </ExperienceBusyContext.Provider>
      </ExperienceGuardContext.Provider>
    </MutationGate.Provider>
  );
}
function ExperienceDetail({
  tenant,
  workspace,
  entry,
  changed,
  edit,
  chooseVersion,
  onDenied,
}: {
  tenant: string;
  workspace: string;
  entry: ExperienceEntry;
  changed: (e: ExperienceEntry) => void;
  edit: () => void;
  chooseVersion: (version: string) => void;
  onDenied: (e: unknown) => void;
}) {
  const blocked = useContext(ExperienceBusyContext);
  const [activeAction, setActiveAction] = useState<'publish' | 'withdraw'>();
  const [confirmed, setConfirmed] = useState(false),
    [history, setHistory] = useState(false),
    [page, setPage] = useState(0),
    [eventPage, setEventPage] = useState(0);
  const action = useSubmission<{
    action: 'publish' | 'withdraw';
    expectedRevision: number;
    versionId: string;
    independentCopyConfirmed: boolean;
  }>();
  useExperienceGuard(action.busy || action.uncertain);
  const versions = useRemote(
    (signal) =>
      history ? api.versions(tenant, workspace, entry.id, page * 20, signal) : Promise.resolve(null),
    [tenant, workspace, entry.id, history, page],
  );
  const events = useRemote(
    (signal) =>
      history ? api.events(tenant, workspace, entry.id, eventPage * 20, signal) : Promise.resolve(null),
    [tenant, workspace, entry.id, history, eventPage],
  );
  const c = entry.version.content,
    current = entry.publishedVersion === entry.version.id;
  const perform = (kind: 'publish' | 'withdraw') => {
    if (!action.uncertain) setActiveAction(kind);
    void action.submit(
      {
        action: kind,
        expectedRevision: entry.revision,
        versionId: entry.version.id,
        independentCopyConfirmed: confirmed,
      },
      async (b, key) => {
        try {
          changed(
            b.action === 'publish'
              ? await api.publish(tenant, workspace, entry.id, {
                  requestId: key,
                  expectedRevision: b.expectedRevision,
                  versionId: b.versionId,
                  independentCopyConfirmed: b.independentCopyConfirmed,
                })
              : await api.withdraw(tenant, workspace, entry.id, {
                  requestId: key,
                  expectedRevision: b.expectedRevision,
                }),
          );
        } catch (e) {
          onDenied(e);
          throw e;
        }
      },
    );
  };
  useEffect(() => {
    if (versions.error || events.error) onDenied(versions.error || events.error);
  }, [versions.error, events.error, onDenied]);
  return (
    <article className="experience-detail">
      <div className="experience-section-head">
        <h3>{c.title}</h3>
        <Badge>
          {states[entry.status]} · 当前查看 v{entry.version.number}
        </Badge>
      </div>
      <div className="experience-detail-meta">
        <span>人工整理 · 尚未评测</span>
        <span>
          {current ? '此版本当前生效' : `当前生效版本：${entry.publishedVersion ? '另一个版本' : '无'}`}
        </span>
        <span>{c.accessMode === 'SOURCE_BOUND' ? '持续依赖来源权限' : '独立人工整理副本'}</span>
      </div>
      <p>{c.summary}</p>
      <div className="experience-boundaries">
        <div>
          <h4>适用条件</h4>
          <p>{c.applicable}</p>
        </div>
        <div>
          <h4>不适用与反例</h4>
          <p>{c.excluded || '尚未整理，需要本次判断。'}</p>
        </div>
      </div>
      <DocumentText text={c.body} />
      <h4>资料、工具与版本依赖</h4>
      <p>{c.dependencies || '未填写；使用前核对当前能力。'}</p>
      <h4>依据与未知事项</h4>
      <p>{c.basis}</p>
      <h4>当前可访问的证据引用</h4>
      {entry.version.evidence.length ? (
        <ul className="experience-refs">
          {entry.version.evidence.map((e) => (
            <li key={e.kind + e.referenceId}>
              {e.kind === 'TASK' ? '任务' : '固定资料版本'} · {e.referenceId}
              <small>来源空间：{e.workspaceId}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="experience-note">没有可显示的证据引用。独立正文不附带受限来源的访问权限。</p>
      )}
      {entry.canMaintain && (
        <section className="experience-maintain">
          <div className="experience-actions">
            <Button disabled={blocked} onClick={edit}>
              整理新版本
            </Button>
            <Button disabled={blocked} onClick={() => setHistory(!history)}>
              {history ? '收起版本与发布记录' : '版本与发布记录'}
            </Button>
          </div>
          {!current && c.accessMode === 'INDEPENDENT_COPY' && (
            <label className="experience-checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={action.busy || action.uncertain}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              我确认此处手工填写的经验正文可以在本工作空间发布为独立副本；此确认不公开源会话或原件。
            </label>
          )}
          <div className="experience-actions">
            {!current && (
              <Button
                variant="primary"
                disabled={
                  (blocked && !action.uncertain) ||
                  (action.uncertain && activeAction !== 'publish') ||
                  (c.accessMode === 'INDEPENDENT_COPY' && !confirmed)
                }
                onClick={() => perform('publish')}
              >
                {action.uncertain ? '重试同次发布' : `发布此版本 v${entry.version.number}`}
              </Button>
            )}
            {entry.publishedVersion && (
              <Button
                variant="danger"
                disabled={(blocked && !action.uncertain) || (action.uncertain && activeAction !== 'withdraw')}
                onClick={() => perform('withdraw')}
              >
                {action.uncertain ? '重试同次撤回' : '撤回当前生效版本'}
              </Button>
            )}
          </div>
          <SubmitError error={action.error} uncertain={action.uncertain} />
          {history && (
            <div className="experience-history">
              <h4>不可变内容版本</h4>
              {versions.error ? (
                <Failure error={versions.error} retry={() => setHistory(false)} />
              ) : !versions.value ? (
                <Loading />
              ) : (
                <>
                  <ul>
                    {versions.value.items.map((v) => (
                      <li key={v.id}>
                        <Button
                          disabled={action.busy || action.uncertain}
                          onClick={() => {
                            if (!blocked) chooseVersion(v.id);
                          }}
                        >
                          查看 v{v.number} · {v.content.title}
                        </Button>
                        <small>{new Date(v.createdAt).toLocaleString('zh-CN')}</small>
                      </li>
                    ))}
                  </ul>
                  <Pager page={page} next={versions.value.hasMore} onPage={setPage} />
                </>
              )}
              <h4>发布与撤回记录</h4>
              {events.error ? (
                <Failure error={events.error} retry={() => setHistory(false)} />
              ) : !events.value ? (
                <Loading />
              ) : (
                <>
                  <ul>
                    {events.value.items.map((e) => (
                      <li key={e.id}>
                        <span>
                          修订 {e.revision} ·{' '}
                          {
                            {
                              CREATED: '创建候选',
                              REVISED: '新增候选版本',
                              PUBLISHED: '发布版本',
                              WITHDRAWN: '撤回生效版本',
                            }[e.action]
                          }
                        </span>
                        <small>
                          {new Date(e.createdAt).toLocaleString('zh-CN')} · 操作者 {e.actorId}
                        </small>
                      </li>
                    ))}
                  </ul>
                  <Pager page={eventPage} next={events.value.hasMore} onPage={setEventPage} />
                </>
              )}
            </div>
          )}
        </section>
      )}
      <ExperienceUsePanel tenant={tenant} workspace={workspace} entry={entry} onDenied={onDenied} />
    </article>
  );
}
