import { useContext, useState } from 'react';
import type { LifecycleItem, ObjectAction, ObjectKind } from '../../contracts/public-api/object-lifecycle';
import { identityClient, useSession } from '../identity/session';
import { Badge, Button, Field, Modal } from '../shared/ui';
import { Failure, FormActions, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { useRequestLock, RequestPending } from '../shared/request-guard';
import {
  objectLifecycleClient as api,
  kinds,
  states,
  kindLabel,
  stateLabel,
  actionLabel,
  blockerLabel,
} from './client';
import './object-lifecycle.css';
const date = (s: string | null) =>
  s ? new Date(s).toLocaleString('zh-CN', { timeZoneName: 'short' }) : '无自动到期';
export function ObjectLifecycleWorkspace({ tenant }: { tenant?: string }) {
  const pending = useContext(RequestPending);
  const { session } = useSession(),
    [workspace, setWorkspace] = useState<string | null>(null),
    [kind, setKind] = useState<ObjectKind | null>(null),
    [state, setState] = useState<string | null>(null),
    [page, setPage] = useState(0),
    [refresh, setRefresh] = useState(0),
    [selected, setSelected] = useState<LifecycleItem | null>(null);
  const context = useRemote(
    (signal) => (tenant ? identityClient.context(tenant, signal) : Promise.resolve(null)),
    [tenant, session.identity],
  );
  const space = workspace ?? context.value?.workspaces[0]?.id ?? null;
  const data = useRemote(
    async (signal) => ({
      items:
        tenant && !space
          ? null
          : await api.list(tenant, tenant ? space : null, kind, state, page * 20, signal),
      technical: tenant ? null : await api.technical(signal),
    }),
    [tenant, space, kind, state, page, refresh, session.identity],
  );
  const changed = () => setRefresh((v) => v + 1);
  return (
    <section className="access-panel object-lifecycle-panel">
      <header>
        <h2>{tenant ? '内容回收与清理' : '通用评估资产与清理状态'}</h2>
        <p className="muted">维护同一对象的使用状态与在线正文。平台技术汇总不提供客户对象或正文入口。</p>
        <Button onClick={changed} disabled={pending}>
          刷新生命周期
        </Button>
      </header>
      {context.error || data.error ? (
        <Failure error={context.error ?? data.error} retry={changed} />
      ) : context.value === undefined || !data.value ? (
        <Loading />
      ) : (
        <>
          <div className="object-lifecycle-toolbar">
            {tenant && (
              <Field label="维护范围">
                <select
                  disabled={pending}
                  aria-label="维护范围"
                  value={space ?? ''}
                  onChange={(e) => {
                    setWorkspace(e.target.value);
                    setPage(0);
                  }}
                >
                  {context.value?.workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="对象类型">
              <select
                disabled={pending}
                aria-label="对象类型"
                value={kind ?? ''}
                onChange={(e) => {
                  setKind((e.target.value || null) as ObjectKind | null);
                  setPage(0);
                }}
              >
                <option value="">全部已获权对象</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {kindLabel[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="生命周期状态">
              <select
                disabled={pending}
                aria-label="生命周期状态"
                value={state ?? ''}
                onChange={(e) => {
                  setState(e.target.value || null);
                  setPage(0);
                }}
              >
                <option value="">全部状态</option>
                {states.map((s) => (
                  <option key={s} value={s}>
                    {stateLabel[s]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="muted">
            截止按原事件和采用的政策版本固定；查看、下载或清理重试不会续期。恢复后保持停用，重新启用也不会自动重启旧任务。历史旧对象未自动加入到期清理。
          </p>
          {data.value.items?.items.length ? (
            data.value.items.items.map((item) => (
              <article
                className="object-lifecycle-item"
                key={item.kind + item.objectId}
                aria-label={`${kindLabel[item.kind]} ${item.objectId}`}
              >
                <div>
                  <h3>
                    {kindLabel[item.kind]} · {item.objectId.slice(0, 8)}
                  </h3>
                  <Badge>{stateLabel[item.state]}</Badge>
                  <p className="muted">对象标识 {item.objectId}</p>
                  <p>
                    原始时间：{date(item.originalAnchor)}
                    <br />
                    清理截止：{date(item.purgeAfter)}
                    {item.policyKey && (
                      <>
                        {' '}
                        · 政策 {item.policyKey} / {item.policyRevision ?? '待绑定'}
                      </>
                    )}
                  </p>
                  {item.errorCode && <p role="status">清理失败，可重试；正文继续停止正常使用。</p>}
                  {item.completedAt && (
                    <p>在线正文清理完成：{date(item.completedAt)}；备份清理状态独立核对。</p>
                  )}
                </div>
                <Button disabled={pending} onClick={() => setSelected(item)}>
                  查看维护动作
                </Button>
              </article>
            ))
          ) : (
            <p>此范围没有当前获权的匹配对象。</p>
          )}
          <Pager
            page={page}
            next={data.value.items?.hasMore ?? false}
            onPage={(v) => {
              if (!pending) setPage(v);
            }}
          />
          {data.value.technical && (
            <aside aria-label="跨企业技术状态">
              <h3>跨企业技术汇总</h3>
              <p className="muted">仅类型、状态和数量；没有企业内容索引、对象标识或正文。</p>
              {data.value.technical.map((t) => (
                <p key={t.kind + t.state}>
                  {kindLabel[t.kind]} · {stateLabel[t.state]}：{t.count}
                </p>
              ))}
            </aside>
          )}
        </>
      )}
      {selected && (
        <ObjectLifecycleDetail
          tenant={tenant}
          selected={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            changed();
          }}
        />
      )}
    </section>
  );
}
export function ObjectLifecycleDetail({
  tenant,
  selected,
  onClose,
  onDone,
  inline = false,
}: {
  tenant?: string;
  selected: Pick<LifecycleItem, 'kind' | 'objectId'>;
  onClose: () => void;
  onDone?: () => void;
  inline?: boolean;
}) {
  const [refresh, setRefresh] = useState(0),
    [action, setAction] = useState<ObjectAction | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [accepted, setAccepted] = useState<number | null>(null);
  const submit = useSubmission<{ item: LifecycleItem; action: ObjectAction; confirmed: boolean }>();
  useRequestLock(submit.busy || submit.uncertain);
  const data = useRemote(
    async (signal) => ({
      preview: await api.get(tenant, selected.kind, selected.objectId, signal),
      history: await api.history(tenant, selected, 0, signal),
    }),
    [tenant, selected.objectId, selected.kind, refresh],
  );
  const locked = submit.busy || submit.uncertain;
  const content = (
    <div className="object-lifecycle-detail" aria-label="版本生命周期维护">
      <Button disabled={locked} onClick={() => setRefresh((v) => v + 1)}>
        刷新当前状态
      </Button>
      {accepted !== null && (
        <p role="status">操作已接受，确切修订 {accepted}。清理是否完成以当前状态为准。</p>
      )}
      {data.error ? (
        <Failure error={data.error} retry={() => setRefresh((v) => v + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <p>
            {kindLabel[selected.kind]} · {selected.objectId}
          </p>
          <p>
            当前状态：{stateLabel[data.value.preview.object.state]} · 修订{' '}
            {data.value.preview.object.revision}
          </p>
          <p>当前截止：{date(data.value.preview.object.purgeAfter)}</p>
          <p>
            现在移入回收站的截止：{date(data.value.preview.trashDeadline)}
            。已有更早到期或退出截止继续优先生效。
          </p>
          {data.value.preview.trialDeadline && (
            <p>按临时试验保存时的截止：{date(data.value.preview.trialDeadline)}，从原生成时间起算。</p>
          )}
          {data.value.preview.blockers.length > 0 && (
            <aside className="object-lifecycle-blockers" role="status">
              <strong>当前维护限制</strong>
              <ul>
                {data.value.preview.blockers.map((b) => (
                  <li key={b}>{blockerLabel[b] ?? `此版本存在维护依赖（${b}）。`}</li>
                ))}
              </ul>
              <p>此处仅说明依赖类型，不显示其他人的私人任务内容。</p>
            </aside>
          )}
          {!data.value.preview.object.actions.length && <p>当前没有可执行的维护动作。</p>}
          {data.value.preview.methodDependency && (
            <p role="status">这份依据支撑当前已采用方法，须先明确停止相关采用，才能停用或清理。</p>
          )}
          <p>
            永久清理会擦除在线正文和受其约束的派生内容。独立企业发布副本按自身规则保留；必要身份、原判定与分母、幂等及授权事实保留。此结果不代表所有旧备份已删除。
          </p>
          <Field label="维护动作">
            <select
              aria-label="维护动作"
              disabled={locked}
              value={action ?? ''}
              onChange={(e) => {
                setAction(e.target.value as ObjectAction);
                setConfirmed(false);
              }}
            >
              <option value="">请选择明确动作</option>
              {data.value.preview.object.actions.map((a) => (
                <option key={a} value={a}>
                  {actionLabel[a]}
                </option>
              ))}
            </select>
          </Field>
          {action === 'PURGE' && (
            <label>
              <input
                type="checkbox"
                disabled={locked}
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              我确认在线正文不可恢复，独立发布副本和必要记录另按规则保留
            </label>
          )}
          {action === 'RESTORE' && <p>恢复到停用状态，需要另行明确启用；不会恢复旧权限或自动继续任务。</p>}
          {action === 'CLASSIFY_TRIAL' && (
            <p>
              这是明确将本次评估的详细中间产物改按试验期限保留，正式标准和样例保持独立；已过截止会直接排队清理。
            </p>
          )}
          <SubmitError error={submit.error} uncertain={submit.uncertain} />
          <FormActions>
            <Button disabled={locked} onClick={onClose}>
              {inline ? '返回版本记录' : '关闭维护'}
            </Button>
            <Button
              disabled={
                submit.busy ||
                !action ||
                (!submit.uncertain && !data.value.preview.object.actions.includes(action)) ||
                (action === 'PURGE' && !confirmed)
              }
              onClick={() => {
                if (action)
                  void submit.submit(
                    { item: data.value!.preview.object, action, confirmed },
                    async (body, key) => {
                      const receipt = await api.act(tenant, body.item, key, body.action, body.confirmed);
                      setAccepted(receipt.acceptedRevision);
                      setAction(null);
                      setConfirmed(false);
                      setRefresh((v) => v + 1);
                      onDone?.();
                    },
                  );
              }}
            >
              {submit.busy
                ? '正在提交…'
                : submit.uncertain
                  ? '用原请求核对结果'
                  : action
                    ? actionLabel[action]
                    : '执行所选动作'}
            </Button>
          </FormActions>
          <h3>必要操作记录</h3>
          {data.value.history.items.map((h) => (
            <p key={h.revision}>
              修订 {h.revision} · {actionLabel[h.action as ObjectAction] ?? h.action} · {date(h.createdAt)}
            </p>
          ))}
          {data.value.history.hasMore && <p className="muted">仅显示最近 20 条记录。</p>}
        </>
      )}
    </div>
  );
  return inline ? (
    <section className="object-lifecycle-inline">{content}</section>
  ) : (
    <Modal
      title="对象维护"
      onClose={() => {
        if (!locked) onClose();
      }}
    >
      {content}
    </Modal>
  );
}
