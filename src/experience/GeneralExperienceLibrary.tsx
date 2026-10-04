import { useEffect, useState } from 'react';
import { BookOpen, RefreshCw } from 'lucide-react';
import { useSession } from '../identity/session';
import { record, uuid } from '../identity/client';
import { Badge, Button, Empty, Field, Modal } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { pageState, textState, useViewState } from '../shared/useViewState';
import { generalExperienceClient as api, generalProcessingLabels } from './general-client';
import './management.css';
type Selection = { id: string; version: string };
const selectionState = (v: unknown): v is Selection | null =>
  v === null || (record(v) && uuid(v.id) && uuid(v.version));
const stamp = (v: string) => new Date(v).toLocaleString('zh-CN', { hour12: false });

export function GeneralExperienceLibrary({ tenant }: { tenant?: string }) {
  const { session } = useSession();
  const scope = tenant || 'platform';
  const [tab, setTab] = useViewState(
    scope,
    'general:tab',
    'content',
    (v): v is string => v === 'content' || v === 'processing',
  );
  const [query, setQuery] = useViewState(scope, 'general:query', '', textState),
    [input, setInput] = useState(query);
  const [state, setState] = useViewState(
    scope,
    'general:state',
    'AVAILABLE',
    (v): v is string => v === 'AVAILABLE' || v === 'STOPPED',
  );
  const [page, setPage] = useViewState(scope, 'general:page', 0, pageState);
  const [selection, select] = useViewState<Selection | null>(
    scope,
    'general:selection',
    null,
    selectionState,
  );
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((n) => n + 1);
  const processing = !tenant && tab === 'processing';
  const data = useRemote(
    (signal) =>
      processing
        ? Promise.resolve(null)
        : api.contents(tenant, query, tenant ? 'AVAILABLE' : state, page * 20, signal),
    [tenant, query, state, page, attempt, processing, session.identity],
  );
  const observation = useRemote(
    (signal) => (processing ? api.processing(signal) : Promise.resolve(null)),
    [processing, attempt, session.identity],
  );
  useEffect(() => {
    if (!processing || selection) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setAttempt((n) => n + 1);
    }, 30000);
    return () => clearInterval(id);
  }, [processing, selection]);
  const error = data.error || observation.error;
  useEffect(() => {
    if (error) select(null);
  }, [error, select]);
  return (
    <div className="admin-dashboard experience-management">
      <div
        className="experience-management-tabs"
        role={tenant ? undefined : 'tablist'}
        aria-label="通用经验库板块"
      >
        {tenant ? (
          <strong>通用经验</strong>
        ) : (
          <>
            <Button
              role="tab"
              aria-selected={!processing}
              variant={!processing ? 'primary' : 'ghost'}
              onClick={() => setTab('content')}
            >
              经验内容
            </Button>
            <Button
              role="tab"
              aria-selected={processing}
              variant={processing ? 'primary' : 'ghost'}
              onClick={() => setTab('processing')}
            >
              积累与改进
            </Button>
          </>
        )}
        <Button icon={RefreshCw} variant="ghost" onClick={refresh}>
          刷新
        </Button>
      </div>
      {processing ? (
        <p className="muted">自动脱敏、提炼和核验后的积累概况。每 30 秒更新，无需人工审核。</p>
      ) : (
        <>
          <p className="muted">经过自动脱敏、提炼和核验的通用方法。适用条件与限制随内容保留。</p>
          <form
            className="experience-management-filters"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(input);
              setPage(0);
            }}
          >
            <Field label="搜索通用经验">
              <input
                aria-label="搜索通用经验"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="名称、用途或标签"
                maxLength={200}
              />
            </Field>
            {!tenant && (
              <Field label="状态">
                <select
                  aria-label="通用经验状态"
                  value={state}
                  onChange={(e) => {
                    setState(e.target.value);
                    setPage(0);
                    select(null);
                  }}
                >
                  <option value="AVAILABLE">当前可用</option>
                  <option value="STOPPED">已停用</option>
                </select>
              </Field>
            )}
            <Button type="submit">搜索</Button>
          </form>
        </>
      )}
      {error ? (
        <Failure error={error} retry={refresh} />
      ) : processing ? (
        !observation.value ? (
          <Loading />
        ) : (
          <>
            {!observation.value.enabled && <p role="status">自动上送尚未启用，以下保留已有处理记录。</p>}
            <div className="experience-processing-metrics">
              {(
                [
                  ['当前可用', observation.value.available],
                  ['已停用', observation.value.stopped],
                  ['来源撤回', observation.value.withdrawn],
                ] as const
              ).map(([label, value]) => (
                <section className="admin-section" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </section>
              ))}
            </div>
            <h2 className="general-experience-heading">自动处理</h2>
            <p className="muted">
              以下按已登记的贡献来源计数；入库次数不等于当前经验数量，也不代表使用效果。
            </p>
            <div className="experience-processing-metrics">
              {Object.entries(generalProcessingLabels).map(([key, label]) => (
                <section className="admin-section" key={key}>
                  <span>{label}</span>
                  <strong>{observation.value!.counts[key as keyof typeof generalProcessingLabels]}</strong>
                </section>
              ))}
            </div>
            <p className="muted">最近更新：{stamp(observation.value.checkedAt)}</p>
          </>
        )
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          {data.value.items.length ? (
            <div className="experience-management-list">
              {data.value.items.map((item) => (
                <button
                  className="experience-management-card"
                  key={item.id}
                  onClick={() => select({ id: item.id, version: item.versionId })}
                >
                  <div>
                    <Badge>通用经验</Badge>
                    <span>
                      {item.status === 'STOPPED' ? '已停用' : '当前可用'} · v{item.number}
                    </span>
                  </div>
                  <h2>{item.title}</h2>
                  <p>{item.summary}</p>
                  <footer>
                    <span className="experience-management-tags">
                      {item.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </span>
                    <time>{stamp(item.updatedAt)}</time>
                  </footer>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              icon={BookOpen}
              title={query ? '没有匹配的通用经验' : '暂无通用经验'}
              text="满足清洗和自动核验要求的方法入库后，会显示在这里。"
            />
          )}
          <Pager page={page} next={data.value.hasMore} onPage={setPage} />
        </>
      )}
      {selection && !error && (
        <GeneralDetail
          key={selection.id + selection.version}
          tenant={tenant}
          selection={selection}
          close={() => select(null)}
        />
      )}
    </div>
  );
}

function GeneralDetail({
  tenant,
  selection,
  close,
}: {
  tenant?: string;
  selection: Selection;
  close: () => void;
}) {
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0);
  const data = useRemote(
    (signal) => api.detail(tenant, selection.id, selection.version, signal),
    [tenant, selection.id, selection.version, attempt, session.identity],
  );
  const d = data.value;
  return (
    <Modal title="通用经验详情" className="experience-management-drawer" onClose={close}>
      {data.error ? (
        <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !d ? (
        <Loading />
      ) : (
        <article className="general-experience-detail">
          <div className="experience-management-tags">
            <Badge>自动核验通过</Badge>
            <Badge>{d.status === 'STOPPED' ? '已停用' : '当前可用'}</Badge>
            <span>v{d.number}</span>
          </div>
          <h2>{d.method.title}</h2>
          <p>{d.method.summary}</p>
          <div className="experience-management-tags">
            {d.method.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
          <h3>方法步骤</h3>
          <ol>
            {d.method.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <h3>适用条件</h3>
          <ul>
            {d.method.applicable.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <h3>限制</h3>
          <ul>
            {d.method.excluded.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <details>
            <summary>依据说明</summary>
            <p>
              {d.method.basis === 'OBSERVED_EXECUTION' ? '提炼依据为实际执行记录。' : '提炼依据为反馈纠正。'}{' '}
              自动核验通过不代表已证明所有业务效果。
            </p>
            <p className="muted">更新时间：{stamp(d.updatedAt)}</p>
          </details>
        </article>
      )}
    </Modal>
  );
}
