import { useContext, useRef, useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { useSession } from '../identity/session';
import { Badge, Button, Field, Modal } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import {
  companyClient,
  companyFields,
  type CompanyAnalysisStatus,
  type CompanyChange,
  type CompanyGroup,
  type CompanyTag,
} from './company-client';
import { profileClient } from './client';
import { CompanySuggestions } from './CompanySuggestions';
import './company.css';
import { CompanyBackgroundSource } from './CompanyBackgroundSource';
const when = (v: string) => new Date(v).toLocaleString('zh-CN', { hour12: false });
export function CompanyInformation({ tenant }: { tenant: string }) {
  const { session } = useSession();
  const pending = useContext(RequestPending);
  const [attempt, setAttempt] = useState(0),
    [notice, setNotice] = useState('');
  const [edit, setEdit] = useState<{
    group: CompanyGroup;
    tag?: CompanyTag;
    action: CompanyChange['action'];
  } | null>(null);
  const analysis = useRemote(
    (signal) => companyClient.analysis(tenant, signal),
    [tenant, attempt, session.identity],
  );
  useEffect(() => {
    if (pending || edit) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setAttempt((n) => n + 1);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [pending, edit, tenant]);
  const data = useRemote((signal) => companyClient.get(tenant, signal), [tenant, attempt, session.identity]);
  return (
    <div className="admin-dashboard company-information">
      <section className="admin-section">
        <header className="company-header">
          <div>
            <h2>企业背景信息</h2>
            <p className="muted">全部选填，用于企业内的工作参考。这里不改变企业身份、组织或权限。</p>
          </div>
          <Button
            disabled={pending}
            variant="ghost"
            icon={RefreshCw}
            onClick={() => setAttempt((n) => n + 1)}
          >
            刷新
          </Button>
        </header>
        <p className="muted">自动整理：从获准资料整理企业背景，不表示知识已使用这些背景。</p>
        <p className="company-analysis muted" role="status">
          {analysis.error
            ? '暂时无法读取自动整理状态，可刷新重试。'
            : analysis.value
              ? analysisSummary(analysis.value)
              : '正在读取自动整理状态…'}
        </p>
        {notice && (
          <p role="status" className="access-success">
            {notice}
          </p>
        )}
        {data.error ? (
          <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
        ) : !data.value ? (
          <Loading />
        ) : (
          data.value.groups.map((group) => (
            <section className="company-group" key={group.field}>
              <div className="company-group-heading">
                <h3>{companyFields[group.field]}</h3>
                <span className="muted">选填</span>
              </div>
              <div className="company-tags">
                {group.tags.map((tag) => (
                  <button
                    className={group.field === 'NAME' ? 'company-name' : 'company-tag'}
                    disabled={pending}
                    key={tag.id}
                    onClick={() => setEdit({ group, tag, action: 'EDIT' })}
                  >
                    {tag.label}
                  </button>
                ))}
                {data.value?.canMaintain && (group.field !== 'NAME' || !group.tags.length) && (
                  <Button
                    variant="ghost"
                    disabled={pending || group.tags.length >= 30}
                    icon={Plus}
                    onClick={() => setEdit({ group, action: 'ADD' })}
                  >
                    {group.field === 'NAME' ? '填写名称' : '添加标签'}
                  </Button>
                )}
              </div>
              {!group.tags.length && (
                <p className="muted">
                  {group.manuallyCleared ? '已由人工清空，保持为空。' : '尚未填写，不影响使用。'}
                </p>
              )}
              {group.tags.length > 0 && (
                <small className="muted">
                  点击查看来源与修改记录{data.value?.canMaintain ? '，或调整内容。' : '。'}
                </small>
              )}
              {data.value?.canMaintain && group.tags.length > 0 && (
                <Button
                  variant="ghost"
                  className="company-clear"
                  disabled={pending}
                  onClick={() => setEdit({ group, action: 'CLEAR' })}
                >
                  清空此项
                </Button>
              )}
            </section>
          ))
        )}
        {data.value?.canMaintain && (
          <CompanySuggestions
            tenant={tenant}
            groups={data.value.groups}
            changed={() => {
              setNotice('处理结果已保存。');
              setAttempt((n) => n + 1);
            }}
          />
        )}
      </section>
      {edit &&
        data.value &&
        (!edit.tag ||
          data.value.groups.some(
            (g) => g.field === edit.group.field && g.tags.some((t) => t.id === edit.tag?.id),
          )) && (
          <CompanyEditor
            key={edit.group.field + (edit.tag?.id || edit.action)}
            tenant={tenant}
            {...edit}
            writable={!!data.value?.canMaintain}
            close={() => setEdit(null)}
            changed={() => {
              setEdit(null);
              setNotice('企业信息已更新。背景保存成功不代表知识已更新。');
              setAttempt((n) => n + 1);
            }}
          />
        )}
    </div>
  );
}
function analysisSummary(status: CompanyAnalysisStatus) {
  const labels = {
    DISABLED: '自动整理未启用',
    PROCESSING: '正在自动整理企业信息',
    ATTENTION: '部分资料未完成自动整理',
    WAITING: '等待自动整理',
    IDLE: '暂无待整理资料',
  };
  const counts =
    status.state === 'DISABLED' || status.pending + status.running + status.attention === 0
      ? ''
      : ` · 资料片段：待处理 ${status.pending} · 处理中 ${status.running} · 未完成 ${status.attention}`;
  return (
    labels[status.state] +
    counts +
    (status.lastCompletedAt ? ` · 最近完成 ${when(status.lastCompletedAt)}` : '') +
    '。人工调整优先保留。'
  );
}
function CompanyEditor({
  tenant,
  group,
  tag,
  action: initialAction,
  writable,
  close,
  changed,
}: {
  tenant: string;
  group: CompanyGroup;
  tag?: CompanyTag;
  action: CompanyChange['action'];
  writable: boolean;
  close: () => void;
  changed: () => void;
}) {
  const [label, setLabel] = useState(tag?.label || ''),
    [meaning, setMeaning] = useState(tag?.meaning || ''),
    [action, setAction] = useState(initialAction),
    [history, setHistory] = useState(false),
    [evidence, setEvidence] = useState(false);
  const submit = useSubmission<Omit<CompanyChange, 'requestId'>>();
  const locked = submit.busy || submit.uncertain;
  useRequestLock(locked);
  const abort = useRef(new AbortController());
  useEffect(() => () => abort.current.abort(), []);
  const destructive = action === 'REMOVE' || action === 'CLEAR';
  return (
    <Modal
      title={companyFields[group.field]}
      onClose={() => {
        if (!locked) close();
      }}
    >
      {tag && (
        <p className="muted">
          <Badge>{tag.origin === 'AI' ? 'AI 整理' : '人工调整'}</Badge> · {when(tag.updatedAt)}
        </p>
      )}
      {tag && !destructive && (
        <>
          <Button variant="ghost" disabled={locked} onClick={() => setHistory(!history)}>
            修改记录
          </Button>
          {history && <CompanyHistory tenant={tenant} id={tag.id} />}
          <Button variant="ghost" disabled={locked} onClick={() => setEvidence(!evidence)}>
            信息依据
          </Button>
          {evidence && <CompanyEvidence tenant={tenant} tag={tag} />}
          <details>
            <summary>知识使用情况</summary>
            <CompanyBackgroundSource tenant={tenant} tagId={tag.id} />
          </details>
        </>
      )}
      <form
        className="company-editor"
        onSubmit={(e) => {
          e.preventDefault();
          if (!writable) return;
          void submit.submit(
            {
              field: group.field,
              expectedRevision: group.revision,
              action,
              tagId: tag?.id || null,
              label: destructive ? '' : label.trim(),
              meaning: destructive ? '' : meaning.trim(),
            },
            async (body, requestId) => {
              await companyClient.change(tenant, { ...body, requestId }, abort.current.signal);
              changed();
            },
          );
        }}
      >
        {destructive ? (
          <p>
            {action === 'CLEAR'
              ? '清空这一组内容，保留人工清空标记及历史记录。'
              : '移除此标签，保留人工移除标记及历史记录。'}
          </p>
        ) : (
          <fieldset disabled={locked || !writable}>
            <Field label={group.field === 'NAME' ? '企业名称' : '标签名称'}>
              <input required maxLength={160} value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            {group.field === 'TERM' && (
              <Field label="含义（选填）">
                <textarea
                  maxLength={1000}
                  rows={3}
                  value={meaning}
                  onChange={(e) => setMeaning(e.target.value)}
                />
              </Field>
            )}
          </fieldset>
        )}
        <SubmitError error={submit.error} uncertain={submit.uncertain} />
        <div className="company-editor-actions">
          <Button disabled={locked} onClick={close}>
            关闭
          </Button>
          {writable && (
            <>
              <Button variant="primary" type="submit" disabled={submit.busy}>
                {submit.uncertain
                  ? '重试同一次操作'
                  : action === 'CLEAR'
                    ? '确认清空'
                    : destructive
                      ? '确认移除'
                      : tag
                        ? '保存调整'
                        : '添加'}
              </Button>
              {tag && !destructive && (
                <Button disabled={locked} onClick={() => setAction('REMOVE')}>
                  移除标签
                </Button>
              )}
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
function CompanyEvidence({ tenant, tag }: { tenant: string; tag: CompanyTag }) {
  const [attempt, setAttempt] = useState(0);
  const data = useRemote(
    (signal) => companyClient.evidence(tenant, tag.id, tag.revision, signal),
    [tenant, tag.id, tag.revision, attempt],
  );
  return data.error ? (
    <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
  ) : !data.value ? (
    <Loading />
  ) : (
    <div className="company-evidence">
      {!data.value.length ? (
        <p className="muted">本次内容由人工填写。</p>
      ) : (
        data.value.map((e) => (
          <article key={e.chunkId}>
            <strong>{e.filename}</strong>
            <p className="muted">{e.locator}</p>
            <blockquote>{e.quote}</blockquote>
          </article>
        ))
      )}
    </div>
  );
}
function CompanyHistory({ tenant, id }: { tenant: string; id: string }) {
  const [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0);
  const data = useRemote(
    async (signal) => {
      const history = await profileClient.history(tenant, id, page * 20, signal);
      const items = await Promise.all(
        history.items.map(async (meta) => ({
          meta,
          value: meta.bodyAvailable ? await profileClient.get(tenant, id, meta.revision, signal) : null,
        })),
      );
      return { items, hasMore: history.hasMore };
    },
    [tenant, id, page, attempt],
  );
  return data.error ? (
    <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
  ) : !data.value ? (
    <Loading />
  ) : (
    <div className="company-history">
      {data.value.items.map(({ meta, value }) => {
        let content: { label?: string; meaning?: string } = {};
        try {
          content = value ? JSON.parse(value.value) : {};
        } catch {
          /* Invalid or erased bodies do not masquerade as tags. */
        }
        return (
          <article key={meta.versionId}>
            <strong>
              v{meta.revision} · {when(meta.changedAt)}
            </strong>
            <p>
              {!value
                ? '内容已不可用'
                : meta.status === 'WITHDRAWN'
                  ? '已移除'
                  : content.label || '内容格式不可用'}
            </p>
            {content.meaning && <p>{content.meaning}</p>}
            {value && <small>{value.provenance}</small>}
          </article>
        );
      })}
      {(page > 0 || data.value.hasMore) && <Pager page={page} next={data.value.hasMore} onPage={setPage} />}
    </div>
  );
}
