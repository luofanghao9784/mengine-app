import { useEffect, useRef, useState } from 'react';
import { Download, Inbox, MailOpen, RefreshCw } from 'lucide-react';
import type { ForwardDelivery } from '../../contracts/public-api/forwarding';
import { Button, Empty } from '../shared/ui';
import { Failure, Loading, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';
import { useSession } from '../identity/session';
import { IdentityError } from '../identity/client';
import { materialClient } from '../material/client';
import { forwardingClient as api } from './client';
import './forwarding.css';
export function ForwardInbox({ tenant }: { tenant: string }) {
  return <InboxContents key={tenant} tenant={tenant} />;
}
function InboxContents({ tenant }: { tenant: string }) {
  const { session } = useSession();
  const [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0),
    [showFeed, setShowFeed] = useState(false),
    [expanded, setExpanded] = useState<ForwardDelivery>(),
    [pendingId, setPendingId] = useState<string>(),
    [downloading, setDownloading] = useState(false),
    [downloadError, setDownloadError] = useState<unknown>();
  const mutation = useSubmission<string>(),
    blocked = mutation.busy || mutation.uncertain || downloading;
  useRequestLock(blocked);
  const download = useRef<AbortController | null>(null);
  useEffect(() => () => download.current?.abort(), []);
  const refresh = () => setAttempt((n) => n + 1);
  const feed = useRemote(
    (signal) => api.inbox(tenant, page * 20, signal),
    [tenant, page, attempt, session.identity],
  );
  const opened = expanded && feed.value?.items.some((r) => r.id === expanded.id) ? expanded : undefined;
  const open = (id: string) => {
    setPendingId(id);
    void mutation.submit(id, async (receipt, key) => {
      try {
        setExpanded(await api.open(tenant, receipt, key));
        setPendingId(undefined);
        refresh();
      } catch (e) {
        if (e instanceof IdentityError && [401, 403, 404].includes(e.status)) {
          setExpanded(undefined);
          refresh();
        }
        throw e;
      }
    });
  };
  const saveFile = async (r: ForwardDelivery) => {
    const controller = new AbortController();
    download.current = controller;
    setDownloading(true);
    setDownloadError(undefined);
    try {
      const fresh = await api.open(tenant, r.id, crypto.randomUUID());
      const s = fresh.source;
      const blob = await materialClient.download(
        tenant,
        s.workspaceId,
        s.materialId,
        s.materialVersionId,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = s.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!controller.signal.aborted) {
        setDownloadError(e);
        if (e instanceof IdentityError && [401, 403, 404].includes(e.status)) {
          setExpanded(undefined);
          refresh();
        }
      }
    } finally {
      if (!controller.signal.aborted) setDownloading(false);
    }
  };
  return (
    <section className="forwarding-inbox" aria-label="同事转来的企业成果">
      <header>
        <div>
          <h3>
            <Inbox size={18} />
            同事转来的成果
          </h3>
          <p>既有权限内的站内交付，打开不代表业务完成。</p>
        </div>
        <Button disabled={blocked} aria-expanded={showFeed} onClick={() => setShowFeed(!showFeed)}>
          {showFeed ? '收起同事转发' : '展开同事转发'}
        </Button>
      </header>
      {showFeed && (
        <>
          <Button icon={RefreshCw} disabled={blocked} onClick={refresh}>
            刷新转发
          </Button>
          {feed.error ? (
            <Failure error={feed.error} retry={refresh} />
          ) : !feed.value ? (
            <Loading />
          ) : !feed.value.items.length ? (
            <Empty icon={Inbox} title="暂无获权转发" text="同事明确转给你的企业成果会显示在这里。" />
          ) : (
            <div className="forwarding-cards">
              {feed.value.items.map((r) => (
                <article key={r.id}>
                  <span className="forwarding-state">{r.state === 'OPENED' ? '已打开' : '未打开'}</span>
                  <h4>{r.source.filename}</h4>
                  <p>
                    {r.senderName}转给你 · {r.source.workspaceName} · 版本 {r.source.materialVersion}
                  </p>
                  {r.note && <p>{r.note}</p>}
                  <Button icon={MailOpen} disabled={blocked} onClick={() => open(r.id)}>
                    打开这份转发
                  </Button>
                  {opened?.id === r.id && (
                    <div className="forwarding-opened">
                      <p>已打开此确切版本。下载会再次核对当前权限。</p>
                      <Button icon={Download} disabled={blocked} onClick={() => void saveFile(r)}>
                        下载确切版本
                      </Button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
          <SubmitError error={mutation.error} uncertain={mutation.uncertain} />
          {mutation.uncertain && pendingId && (
            <Button disabled={mutation.busy} onClick={() => open(pendingId)}>
              重试本次打开
            </Button>
          )}
          {!!downloadError && (
            <Failure
              error={downloadError}
              retry={() => {
                if (opened) void saveFile(opened);
              }}
            />
          )}
          <div className="forwarding-pagination">
            <Button disabled={blocked || !page} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <span>第 {page + 1} 页</span>
            <Button disabled={blocked || !feed.value?.hasMore} onClick={() => setPage(page + 1)}>
              下一页
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
