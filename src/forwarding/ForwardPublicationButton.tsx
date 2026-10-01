import { useContext, useState } from 'react';
import { Send, Users } from 'lucide-react';
import type { ForwardBatch, ForwardRequest } from '../../contracts/public-api/forwarding';
import { Button, Field, Modal, Empty } from '../shared/ui';
import { Failure, Loading, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { useSession } from '../identity/session';
import { forwardingClient as api } from './client';
import './forwarding.css';
export function ForwardPublicationButton({
  tenant,
  publicationId,
  materialVersionId,
}: {
  tenant: string;
  publicationId: string;
  materialVersionId: string;
}) {
  const [open, setOpen] = useState(false),
    [locked, setLocked] = useState(false);
  const pending = useContext(RequestPending);
  return (
    <>
      <Button icon={Send} disabled={pending} onClick={() => setOpen(true)}>
        站内转发
      </Button>
      {open && (
        <Modal
          title="转发已发布的企业副本"
          wide
          onClose={() => {
            if (!locked) setOpen(false);
          }}
        >
          <Form
            key={`${tenant}:${publicationId}:${materialVersionId}`}
            tenant={tenant}
            publication={publicationId}
            version={materialVersionId}
            lock={setLocked}
          />
        </Modal>
      )}
    </>
  );
}
function Form({
  tenant,
  publication,
  version,
  lock,
}: {
  tenant: string;
  publication: string;
  version: string;
  lock: (v: boolean) => void;
}) {
  const { session } = useSession();
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [historyPage, setHistoryPage] = useState(0),
    [note, setNote] = useState(''),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [attempt, setAttempt] = useState(0),
    [accepted, setAccepted] = useState<ForwardBatch>();
  const mutation = useSubmission<ForwardRequest>(),
    blocked = mutation.busy || mutation.uncertain;
  useRequestLock(blocked);
  // Persist the exact form while the server acceptance is uncertain.
  useLock(blocked, lock);
  const refresh = () => setAttempt((n) => n + 1);
  const people = useRemote(
    (signal) => api.recipients(tenant, publication, version, query, page * 20, signal),
    [tenant, publication, version, query, page, attempt, session.identity],
  );
  const history = useRemote(
    (signal) => api.history(tenant, publication, version, historyPage * 10, signal),
    [tenant, publication, version, historyPage, attempt, session.identity],
  );
  const currentBatch = useRemote(
    (signal) => (accepted ? api.batch(tenant, accepted.id, signal) : Promise.resolve(null)),
    [tenant, accepted?.id, attempt, session.identity],
  );
  const submit = () =>
    void mutation.submit(
      { publicationId: publication, materialVersionId: version, recipients: Object.keys(selected), note },
      async (body, key) => {
        setAccepted(await api.send(tenant, body, key));
        refresh();
      },
    );
  if (people.error) return <Failure error={people.error} retry={refresh} />;
  if (!people.value) return <Loading />;
  const source = people.value.source;
  return (
    <section className="forwarding-panel">
      <p className="forwarding-source">
        <strong>{source.filename}</strong>
        <span>
          {source.workspaceName} · 确切版本 {source.materialVersion}
        </span>
      </p>
      <p className="muted">仅能选取当前已获权的同事。转发不新增阅读权限，也不附带私人会话和原文稿。</p>
      {accepted && !!currentBatch.error && <Failure error={currentBatch.error} retry={refresh} />}
      {accepted && !currentBatch.error && !currentBatch.value && <Loading />}
      {accepted && currentBatch.value && (
        <div role="status" className="forwarding-receipt">
          <strong>站内已接受 {currentBatch.value.recipients.length} 位接收人的转发</strong>
          <p>接受不代表对方已打开或业务已完成。重试不会追加接收人。</p>
          <BatchRows batch={currentBatch.value} />
        </div>
      )}
      {!accepted && (
        <>
          <Field label="查找当前获权同事">
            <input
              value={query}
              disabled={blocked}
              maxLength={100}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </Field>
          <div className="forwarding-people">
            {people.value.items.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={p.id in selected}
                  disabled={blocked || (!(p.id in selected) && Object.keys(selected).length >= 20)}
                  onChange={(e) =>
                    setSelected((previous) => {
                      const next = { ...previous };
                      if (e.target.checked) next[p.id] = p.name;
                      else delete next[p.id];
                      return next;
                    })
                  }
                />
                <Users size={15} />
                {p.name}
                <small>{p.id.slice(0, 8)}</small>
              </label>
            ))}
            {!people.value.items.length && (
              <Empty
                icon={Users}
                title="没有可选的获权同事"
                text="可先核对目标空间的现有成员；本入口不会新增权限。"
              />
            )}
          </div>
          <div className="forwarding-pagination">
            <Button disabled={blocked || !page} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <span>第 {page + 1} 页</span>
            <Button disabled={blocked || !people.value.hasMore} onClick={() => setPage(page + 1)}>
              下一页
            </Button>
          </div>
          <p>
            已选择 {Object.keys(selected).length}/20 人：{Object.values(selected).join('、') || '尚未选择'}
          </p>
          <Field label="转发说明（可选）">
            <textarea
              value={note}
              disabled={blocked}
              maxLength={500}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Button icon={Send} disabled={mutation.busy || !Object.keys(selected).length} onClick={submit}>
            {mutation.uncertain ? '重试本次站内转发' : '确认站内转发'}
          </Button>
          <SubmitError error={mutation.error} uncertain={mutation.uncertain} />
        </>
      )}
      <details className="forwarding-history">
        <summary>我转发此版本的记录</summary>
        {history.error ? (
          <Failure error={history.error} retry={refresh} />
        ) : !history.value ? (
          <Loading />
        ) : history.value.items.length ? (
          history.value.items.map((b) => (
            <div key={b.id}>
              <p>{new Date(b.acceptedAt).toLocaleString('zh-CN', { hour12: false })}</p>
              <BatchRows batch={b} />
            </div>
          ))
        ) : (
          <p>尚无转发记录。</p>
        )}
        <div className="forwarding-pagination">
          <Button disabled={blocked || !historyPage} onClick={() => setHistoryPage(historyPage - 1)}>
            上一页
          </Button>
          <Button
            disabled={blocked || !history.value?.hasMore}
            onClick={() => setHistoryPage(historyPage + 1)}
          >
            下一页
          </Button>
        </div>
      </details>
    </section>
  );
}
import { useEffect } from 'react';
function useLock(v: boolean, lock: (v: boolean) => void) {
  useEffect(() => {
    lock(v);
    return () => lock(false);
  }, [v, lock]);
}
function BatchRows({ batch }: { batch: ForwardBatch }) {
  return (
    <ul className="forwarding-recipients">
      {batch.recipients.map((r) => (
        <li key={r.receiptId}>
          <span>{r.name}</span>
          <span>
            {r.state === 'OPENED' ? '已打开' : '已接受 · 未打开'}
            {!r.currentlyAccessible ? ' · 当前无访问权' : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
