import { createPortal } from 'react-dom';
import { useContext } from 'react';
import { Square } from 'lucide-react';
import type { ConversationTask } from '../../contracts/public-api/conversation';
import { conversationClient } from './client';
import { Button } from '../shared/ui';
import { useSubmission, SubmitError } from '../shared/admin';
import { RequestPending, useRequestLock } from '../shared/request-guard';

export function TaskSendControl({
  tenant,
  conversation,
  task,
  besideSend,
  noticeHost,
  changed,
}: {
  tenant: string;
  conversation: string;
  task: ConversationTask;
  besideSend?: boolean;
  noticeHost: HTMLDivElement | null;
  changed: () => void;
}) {
  const pending = useContext(RequestPending);
  const submit = useSubmission<{ expectedRevision: number; action: 'PAUSE' }>();
  useRequestLock(submit.busy || submit.uncertain);
  return (
    <>
      <div className={`composer-task-control ${besideSend ? 'beside-send' : ''}`}>
        <Button
          className="live-composer-submit"
          icon={Square}
          aria-label={submit.uncertain ? '重试停止' : submit.busy ? '正在停止' : '停止执行'}
          title="停止执行，保留已有内容"
          disabled={submit.busy || (pending && !submit.uncertain)}
          onClick={() =>
            void submit.submit(
              { expectedRevision: task.revision, action: 'PAUSE' },
              async (body, requestId) => {
                await conversationClient.action(tenant, conversation, task.id, { ...body, requestId });
                changed();
              },
            )
          }
        />
      </div>
      {noticeHost && createPortal(<SubmitError error={submit.error} uncertain={submit.uncertain} />, noticeHost)}
    </>
  );
}
