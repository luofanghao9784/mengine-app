import { useContext, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Conversation } from '../../contracts/public-api/conversation';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { Button } from '../shared/ui';
import { Failure, Loading, SubmitError, useSubmission } from '../shared/admin';
import { useConversationList, ConversationListTail } from './useConversationList';
import { conversationClient } from './client';
import './conversation-management.css';
export function ConversationTrash({ tenant }: { tenant: string }) {
  const [revision, setRevision] = useState(0);
  const list = useConversationList(tenant, revision, true);
  const pending = useContext(RequestPending);
  return (
    <section className="conversation-trash" aria-label="会话回收站">
      <h3>会话回收站</h3>
      {list.error ? (
        <Failure error={list.error} retry={() => setRevision((x) => x + 1)} />
      ) : !list.value ? (
        <Loading />
      ) : (
        <>
          {!list.value.items.length && <p className="muted">回收站为空</p>}
          <div className="conversation-trash-items">
            {list.value.items.map((item) => (
              <TrashItem
                key={item.id}
                tenant={tenant}
                item={item}
                changed={() => setRevision((x) => x + 1)}
              />
            ))}
          </div>
          <ConversationListTail
            hasMore={list.value.hasMore}
            loading={list.loading}
            error={list.moreError}
            blocked={pending}
            loadMore={list.loadMore}
          />
        </>
      )}
    </section>
  );
}
function TrashItem({ tenant, item, changed }: { tenant: string; item: Conversation; changed: () => void }) {
  const pending = useContext(RequestPending);
  const submit = useSubmission<{ expectedRevision: number; action: 'RESTORE'; stopRunning: false }>();
  useRequestLock(submit.busy || submit.uncertain);
  return (
    <div className="conversation-trash-item">
      <span title={item.title}>{item.title}</span>
      <Button
        icon={RotateCcw}
        disabled={submit.busy || (pending && !submit.uncertain)}
        onClick={() =>
          void submit.submit(
            { expectedRevision: item.managementRevision || 0, action: 'RESTORE', stopRunning: false },
            async (body, requestId) => {
              await conversationClient.manage(tenant, item.id, { ...body, requestId });
              changed();
              window.dispatchEvent(new Event('conversation-list-changed'));
            },
          )
        }
      >
        {submit.busy ? '正在恢复…' : submit.uncertain ? '重试恢复' : '恢复'}
      </Button>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
    </div>
  );
}
