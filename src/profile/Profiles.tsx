import { useContext, useState } from 'react';
import type { GovernanceSnapshot } from '../../contracts/public-api/governance';
import type {
  ProfileEntryInfo,
  ProfileKind,
  ProfileScope,
  ProfileValue,
} from '../../contracts/public-api/profile';
import { identityClient, useSession } from '../identity/session';
import { Button, Field, Modal, Badge } from '../shared/ui';
import {
  Failure,
  Loading,
  Pager,
  useRemote,
  useSubmission,
  SubmitError,
  FormActions,
  MutationGate,
} from '../shared/admin';
import { kindLabels, profileClient as api, statusLabels } from './client';
import '../governance/governance.css';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { ObjectLifecycleDetail } from '../objectlifecycle/ObjectLifecycleWorkspace';

export function Profiles({ tenant, management }: { tenant: string; management?: GovernanceSnapshot }) {
  const { session } = useSession();
  const pending = useContext(RequestPending);
  const [attempt, setAttempt] = useState(0),
    [selected, setSelected] = useState('');
  const context = useRemote(
    (signal) => identityClient.context(tenant, signal),
    [tenant, attempt, session.identity],
  );
  if (context.error) return <Failure error={context.error} retry={() => setAttempt((x) => x + 1)} />;
  if (!context.value) return <Loading />;
  const allowed = (workspaceId: string | null) =>
    !management ||
    (workspaceId === null && management.canConfigure) ||
    management.capabilities.some((c) => c.capability === 'PROFILE_MAINTAIN' && c.workspaceId === workspaceId);
  const choices: { id: string; scope: ProfileScope; subject: string; label: string }[] = [
    ...(!management
      ? [
          {
            id: 'personal',
            scope: 'PERSONAL' as const,
            subject: session.identity!.account.id,
            label: '我的档案',
          },
        ]
      : []),
    ...(allowed(null)
      ? [{ id: 'tenant', scope: 'TENANT' as const, subject: tenant, label: '企业档案' }]
      : []),
    ...context.value.workspaces
      .filter((w) => w.kind === 'SHARED' && allowed(w.id))
      .map((w) => ({ id: w.id, scope: 'WORKSPACE' as const, subject: w.id, label: `空间 · ${w.name}` })),
  ];
  const active = choices.find((x) => x.id === selected) || choices[0];
  return (
    <section className="access-panel governance-panel">
      <h2>档案</h2>
      <p className="muted">
        事实、推断、目标和偏好分别保存。档案描述不会授予权限，也不会自行启动任务或持续计划。
      </p>
      {!active ? (
        <p>当前职责没有档案维护范围。其他工作仍可在工作空间中继续。</p>
      ) : (
        <>
          <Field label="档案范围">
            <select
              disabled={pending}
              aria-label="档案范围"
              value={active.id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {choices.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </Field>
          <ProfileList
            key={`${tenant}:${active.id}`}
            tenant={tenant}
            scope={active.scope}
            subject={active.subject}
          />
        </>
      )}
    </section>
  );
}
function ProfileList({ tenant, scope, subject }: { tenant: string; scope: ProfileScope; subject: string }) {
  const { session } = useSession();
  const pending = useContext(RequestPending);
  const [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{
    mode: 'create' | 'edit' | 'history' | 'withdraw';
    value?: ProfileValue;
    entry?: ProfileEntryInfo;
  }>();
  const data = useRemote(
    (signal) => api.list(tenant, scope, subject, page * 20, signal),
    [tenant, scope, subject, page, attempt, session.identity],
  );
  const locked = busy || pending;
  const reload = () => setAttempt((v) => v + 1),
    done = (message: string) => {
      setDialog(undefined);
      setNotice(message);
      reload();
    };
  if (data.error) return <Failure error={data.error} retry={reload} />;
  if (!data.value) return <Loading />;
  return (
    <MutationGate.Provider value={setBusy}>
      <div className="governance-toolbar">
        <Badge>{data.value.canMaintain ? '可以维护' : '只读'}</Badge>
        <Button onClick={reload} disabled={locked}>
          刷新档案
        </Button>
        {data.value.canMaintain && (
          <Button disabled={locked} variant="primary" onClick={() => setDialog({ mode: 'create' })}>
            新增档案记录
          </Button>
        )}
      </div>
      {notice && (
        <p role="status" className="access-success">
          {notice}
        </p>
      )}
      {!data.value.entries.length ? (
        <p className="muted">此范围尚无档案记录。</p>
      ) : (
        <ul className="profile-records">
          {data.value.entries.map((entry) => {
            const v = data.value!.items.find((x) => x.id === entry.id);
            return (
              <li key={entry.id}>
                <div className="governance-toolbar">
                  <strong>{entry.key}</strong>
                  <Badge>{kindLabels[entry.kind]}</Badge>
                  {v && <Badge>{statusLabels[v.effectiveStatus]}</Badge>}
                  <span>版本 {entry.revision}</span>
                </div>
                {v ? (
                  <>
                    <p className="profile-value">{v.value}</p>
                    <p className="muted">依据：{v.provenance}</p>
                    <p className="muted">
                      {v.expiresAt
                        ? `有效至 ${new Date(v.expiresAt).toLocaleString('zh-CN')}`
                        : '未设置到期时间'}{' '}
                      · 修改于 {new Date(v.changedAt).toLocaleString('zh-CN')}
                    </p>
                  </>
                ) : (
                  <p className="muted">正文不可用。保留必要版本索引，可查看历史与维护状态。</p>
                )}
                <div className="governance-toolbar">
                  <Button disabled={locked} onClick={() => setDialog({ mode: 'history', entry })}>
                    查看版本
                  </Button>
                  {!v && data.value!.canMaintain && (
                    <Button disabled={locked} onClick={() => setDialog({ mode: 'edit', entry })}>
                      填写新版本
                    </Button>
                  )}
                  {v && data.value!.canMaintain && (
                    <>
                      <Button disabled={locked} onClick={() => setDialog({ mode: 'edit', value: v })}>
                        修订
                      </Button>
                      {v.status !== 'WITHDRAWN' && (
                        <Button
                          disabled={locked}
                          variant="danger"
                          onClick={() => setDialog({ mode: 'withdraw', value: v })}
                        >
                          撤回
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Pager
        page={page}
        next={data.value.hasMore}
        onPage={(v) => {
          if (!locked) setPage(v);
        }}
      />
      {dialog && (
        <Modal
          title={
            { create: '新增档案记录', edit: '修订档案', history: '档案版本', withdraw: '撤回档案' }[
              dialog.mode
            ]
          }
          onClose={() => {
            if (!locked) {
              setDialog(undefined);
              if (dialog.mode === 'history') reload();
            }
          }}
          wide
        >
          {dialog.mode === 'history' ? (
            <ProfileHistory tenant={tenant} value={dialog.entry!} />
          ) : dialog.mode === 'withdraw' ? (
            <Withdraw
              tenant={tenant}
              value={dialog.value!}
              done={() => done('档案已撤回，历史版本仍保留。')}
            />
          ) : (
            <ProfileForm
              tenant={tenant}
              scope={scope}
              subject={subject}
              value={dialog.value}
              entry={dialog.entry}
              done={() => done(dialog.mode === 'create' ? '档案记录已保存。' : '修订已保存为新版本。')}
            />
          )}
        </Modal>
      )}
    </MutationGate.Provider>
  );
}
function ProfileForm({
  tenant,
  scope,
  subject,
  value,
  entry,
  done,
}: {
  tenant: string;
  scope: ProfileScope;
  subject: string;
  value?: ProfileValue;
  entry?: ProfileEntryInfo;
  done: () => void;
}) {
  const original = value ?? entry;
  const [key, setKey] = useState(original?.key || ''),
    [kind, setKind] = useState<ProfileKind>(original?.kind || 'FACT'),
    [content, setContent] = useState(value?.value || ''),
    [provenance, setProvenance] = useState(value?.provenance || '');
  const [status, setStatus] = useState<'ACTIVE' | 'PROPOSED'>(
    value?.status === 'ACTIVE' ? 'ACTIVE' : 'PROPOSED',
  );
  const [longTerm, setLongTerm] = useState(!!value && !value.expiresAt),
    [expiry, setExpiry] = useState(
      value?.expiresAt
        ? new Date(new Date(value.expiresAt).getTime() - new Date().getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)
        : '',
    );
  const task = useSubmission<{
    key: string;
    kind: ProfileKind;
    value: string;
    provenance: string;
    status: 'ACTIVE' | 'PROPOSED';
    expiresAt: string | null;
  }>();
  useRequestLock(task.busy || task.uncertain);
  return (
    <form
      className="platform-form"
      onSubmit={(e) => {
        e.preventDefault();
        void task.submit(
          {
            key,
            kind,
            value: content.trim(),
            provenance: provenance.trim(),
            status,
            expiresAt:
              kind === 'PREFERENCE' && longTerm ? null : expiry ? new Date(expiry).toISOString() : null,
          },
          async (body, requestId) => {
            if (original)
              await api.save(tenant, original.id, {
                requestId,
                expectedRevision: original.revision,
                value: body.value,
                provenance: body.provenance,
                status: body.status,
                expiresAt: body.expiresAt,
              });
            else await api.create(tenant, scope, subject, { ...body, requestId });
            done();
          },
        );
      }}
    >
      <fieldset disabled={task.busy || task.uncertain}>
        <Field label="档案名称" hint="名称在此范围内唯一；可使用文字、数字、下划线、点和短横线。">
          <input
            aria-label="档案名称"
            required
            maxLength={100}
            value={key}
            disabled={!!original}
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        <Field label="记录类型">
          <select
            aria-label="记录类型"
            value={kind}
            disabled={!!original}
            onChange={(e) => setKind(e.target.value as ProfileKind)}
          >
            {Object.entries(kindLabels).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="内容">
          <textarea
            aria-label="内容"
            required
            maxLength={4000}
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </Field>
        <Field label="依据与来源">
          <textarea
            aria-label="依据与来源"
            required
            maxLength={500}
            rows={2}
            value={provenance}
            onChange={(e) => setProvenance(e.target.value)}
          />
        </Field>
        <Field label="记录状态">
          <select
            aria-label="记录状态"
            value={status}
            onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'PROPOSED')}
          >
            <option value="PROPOSED">待确认</option>
            <option value="ACTIVE">生效</option>
          </select>
        </Field>
        {kind === 'INFERENCE' && <p className="muted">推断生效后仍是推断，不会自动变为事实。</p>}
        {kind === 'PREFERENCE' && (
          <Field label="偏好期限">
            <select
              aria-label="偏好期限"
              value={longTerm ? 'long' : 'temporary'}
              onChange={(e) => setLongTerm(e.target.value === 'long')}
            >
              <option value="temporary">临时偏好，设置到期时间</option>
              <option value="long">明确保存为长期偏好</option>
            </select>
          </Field>
        )}
        {!(kind === 'PREFERENCE' && longTerm) && (
          <Field
            label="有效至"
            hint={kind === 'PREFERENCE' ? '临时偏好到期后不再生效。' : '可留空；到期后保留记录并标为过期。'}
          >
            <input
              aria-label="有效至"
              type="datetime-local"
              required={kind === 'PREFERENCE'}
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </Field>
        )}
        {entry && !value && (
          <p className="muted">原正文不可用。请重新填写内容与依据，保存为新版本；不会恢复旧正文。</p>
        )}
        {original && <p className="muted">基于版本 {original.revision} 创建新版本；原版本保持不变。</p>}
      </fieldset>
      <SubmitError error={task.error} uncertain={task.uncertain} />
      <FormActions>
        <Button type="submit" variant="primary" disabled={task.busy}>
          {task.uncertain ? '重试本次保存' : '保存档案'}
        </Button>
      </FormActions>
    </form>
  );
}
function Withdraw({ tenant, value, done }: { tenant: string; value: ProfileValue; done: () => void }) {
  const task = useSubmission<number>();
  useRequestLock(task.busy || task.uncertain);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void task.submit(value.revision, async (expectedRevision, requestId) => {
          await api.withdraw(tenant, value.id, { expectedRevision, requestId });
          done();
        });
      }}
    >
      <p>撤回“{value.key}”的当前版本后不再作为有效档案使用。历史版本保留。</p>
      <SubmitError error={task.error} uncertain={task.uncertain} />
      <Button type="submit" variant="danger" disabled={task.busy}>
        {task.uncertain ? '重试本次撤回' : '确认撤回'}
      </Button>
    </form>
  );
}
function ProfileHistory({ tenant, value }: { tenant: string; value: ProfileEntryInfo }) {
  const pending = useContext(RequestPending);
  const [version, setVersion] = useState(value.revision),
    [draft, setDraft] = useState(String(value.revision)),
    [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0),
    [maintenance, setMaintenance] = useState<{ versionId: string; revision: number } | null>(null);
  const history = useRemote(
    (signal) => api.history(tenant, value.id, page * 20, signal),
    [tenant, value.id, page, attempt],
  );
  const metadata = history.value?.items.find((x) => x.revision === version);
  const data = useRemote(
    (signal) =>
      maintenance || !history.value || metadata?.bodyAvailable === false
        ? Promise.resolve(null)
        : api.get(tenant, value.id, version, signal),
    [tenant, value.id, version, metadata?.bodyAvailable, !!history.value, maintenance?.versionId, attempt],
  );
  const reload = () => setAttempt((x) => x + 1);
  return (
    <div className="profile-history">
      <p className="muted">
        历史正文只读。维护针对所选确切版本；恢复为停用，需另行明确启用，不会自动成为当前版本。
      </p>
      {history.error ? (
        <Failure error={history.error} retry={reload} />
      ) : !history.value ? (
        <Loading />
      ) : (
        <details open={!maintenance}>
          <summary>版本索引（本页 {history.value.items.length} 条）</summary>
          <div className="profile-history-versions" aria-label="档案历史版本索引">
            {history.value.items.map((v) => (
              <article
                className="profile-version-row"
                key={v.versionId}
                aria-label={`档案版本 ${v.revision}`}
              >
                <div>
                  <strong>
                    版本 {v.revision}
                    {v.current ? ' · 当前记录' : ''}
                  </strong>{' '}
                  <Badge>记录状态：{statusLabels[v.effectiveStatus]}</Badge>
                  <p className="muted">
                    {new Date(v.changedAt).toLocaleString('zh-CN')} ·{' '}
                    {v.bodyAvailable ? '正文可读' : '正文不可用'}
                  </p>
                </div>
                <div className="governance-toolbar">
                  <Button
                    disabled={pending}
                    onClick={() => {
                      setVersion(v.revision);
                      setDraft(String(v.revision));
                      setMaintenance(null);
                    }}
                  >
                    查看版本 {v.revision}
                  </Button>
                  {history.value!.canMaintain && (
                    <Button disabled={pending} onClick={() => setMaintenance(v)}>
                      维护版本 {v.revision}
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
          <Pager
            page={page}
            next={history.value.hasMore}
            onPage={(n) => {
              if (!pending) setPage(n);
            }}
          />
        </details>
      )}
      {maintenance ? (
        <>
          <h3>维护档案版本 {maintenance.revision}</h3>
          <ObjectLifecycleDetail
            key={maintenance.versionId}
            inline
            tenant={tenant}
            selected={{ kind: 'PROFILE_VERSION', objectId: maintenance.versionId }}
            onDone={reload}
            onClose={() => {
              setMaintenance(null);
              reload();
            }}
          />
        </>
      ) : (
        <>
          <form
            className="governance-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pending) setVersion(Number(draft));
            }}
          >
            <Field label="版本号">
              <input
                aria-label="版本号"
                type="number"
                min={1}
                max={value.revision}
                required
                disabled={pending}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </Field>
            <Button disabled={pending} type="submit">
              读取版本
            </Button>
          </form>
          {history.error ? null : data.error ? (
            <Failure error={data.error} retry={reload} />
          ) : data.value === undefined ? (
            <Loading />
          ) : data.value === null ? (
            <p className="muted">此版本正文当前不可用；维护资格与恢复动作以服务端返回为准。</p>
          ) : (
            <>
              <h3>
                {data.value.key} · 版本 {data.value.revision}
              </h3>
              <Badge>{kindLabels[data.value.kind]}</Badge>{' '}
              <Badge>{statusLabels[data.value.effectiveStatus]}</Badge>
              <p className="profile-value">{data.value.value}</p>
              <p>依据：{data.value.provenance}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
