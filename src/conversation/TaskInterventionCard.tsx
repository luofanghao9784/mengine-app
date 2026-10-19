import { useCallback, useContext, useState } from 'react';
import { CircleHelp, Play, RotateCcw, ShieldCheck, X } from 'lucide-react';
import type { ConversationTask, TaskAction, TaskOriginal } from '../../contracts/public-api/conversation';
import type { TenantContext } from '../../contracts/public-api/identity';
import { Button } from '../shared/ui';
import { SubmitError, useSubmission } from '../shared/admin';
import { IdentityError } from '../identity/client';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { AttachmentMaterials } from './AttachmentMaterials';
import { conversationClient } from './client';
import { taskErrorMessage } from './task-errors';

export function TaskInterventionCard({
  tenant,
  conversation,
  task,
  context,
  workspaceId,
  executing,
  respond,
  changed,
}: {
  tenant: string;
  conversation: string;
  task: ConversationTask;
  context: TenantContext;
  workspaceId: string;
  executing: boolean;
  respond: () => void;
  changed: () => void;
}) {
  const pending = useContext(RequestPending);
  const [files, setFiles] = useState<TaskOriginal[]>([]);
  const [uploading, setUploading] = useState(false);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const onReady = useCallback(
    (id: string, value: boolean) => setReady((old) => (old[id] === value ? old : { ...old, [id]: value })),
    [],
  );
  const [draftRequestId] = useState(() => crypto.randomUUID());
  type Body = {
    expectedRevision: number;
    action: TaskAction;
    input?: string;
    originals?: { materialId: string; versionId: string }[];
  };
  const submit = useSubmission<Body>();
  const [last, setLast] = useState<Body>();
  useRequestLock(submit.busy || submit.uncertain || uploading);
  const waiting = task.status === 'WAITING_INPUT';
  const blocked = pending || submit.busy || submit.uncertain || uploading;
  const unavailable = task.sourcesUnavailable || task.reconciliationRequired;
  const send = (body: Body) => {
    setLast(body);
    void submit.submit(body, async (value, requestId) => {
      await conversationClient.action(tenant, conversation, task.id, { ...value, requestId });
      setFiles([]);
      changed();
    });
  };
  if (
    ![
      'WAITING_INPUT',
      'WAITING_CAPABILITY',
      'PAUSED',
      'FAILED',
      'CANCELLED',
      'INTERRUPTED',
      'RESULT_UNKNOWN',
    ].includes(task.status)
  )
    return null;
  if (waiting && task.waitReason === 'PRESENTATION_CONFIRMATION')
    return (
      <div className="task-intervention-actions">
        <SubmitError error={submit.error} uncertain={submit.uncertain} />
        <Button
          variant="ghost"
          disabled={submit.busy || (pending && !submit.uncertain)}
          onClick={() => send({ action: 'CANCEL', expectedRevision: task.revision })}
        >
          {submit.uncertain ? '重试结束任务' : '结束此项工作'}
        </Button>
      </div>
    );
  const title = task.reconciliationRequired
    ? '需要核对执行结果'
    : waiting
      ? '需要你补充信息或资料'
      : task.status === 'WAITING_CAPABILITY'
        ? '暂时无法继续处理'
        : task.status === 'FAILED'
          ? '本次处理未完成'
          : '本次已停止';
  const explanation = task.sourcesUnavailable
    ? '相关资料已不可访问，请检查资料权限。'
    : task.reconciliationRequired
      ? '这次工作还没有得到确认的结果。请先查看已经完成的步骤，核对后再决定是否继续。'
      : waiting
        ? task.requiredInput || '请补充所需信息，或添加相关资料后继续。'
        : task.status === 'WAITING_CAPABILITY'
          ? '所需模型或工具当前不可用，可以稍后再次尝试。'
          : task.errorCode
            ? taskErrorMessage(task.errorCode)
            : '已保留现有回复和成果，需要时可以继续处理。';
  const retry = ['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(task.status);
  return (
    <section className="task-intervention-card" aria-label={title}>
      <header>
        <CircleHelp size={17} aria-hidden="true" />
        <strong>{title}</strong>
      </header>
      <p>{explanation}</p>
      {waiting && !unavailable && (
        <fieldset className="task-intervention-files" disabled={submit.busy || submit.uncertain || pending}>
          <AttachmentMaterials
            tenant={tenant}
            conversation={conversation}
            draftRequestId={draftRequestId}
            workspaceId={workspaceId}
            context={context}
            files={files}
            setFiles={(next) => {
              setReady((previous) =>
                Object.fromEntries(
                  Object.entries(previous).filter(([id]) => next.some((file) => file.versionId === id)),
                ),
              );
              setFiles(next);
            }}
            onConversation={() => {}}
            onBusy={setUploading}
            onReady={onReady}
            verification={task.executionClass === 'verification'}
          />
        </fieldset>
      )}
      {executing && (
        <p className="task-intervention-conflict" role="status">
          另一项工作正在执行，请先停止当前执行，再处理此卡片。
        </p>
      )}
      <div className="task-intervention-actions">
        {submit.uncertain && last ? (
          <Button onClick={() => send(last)} disabled={submit.busy}>
            重试本次操作
          </Button>
        ) : (
          <>
            {task.reconciliationRequired ? (
              <Button
                icon={ShieldCheck}
                disabled={blocked || executing || task.sourcesUnavailable}
                onClick={() => send({ action: 'RECONCILE', expectedRevision: task.revision })}
              >
                核对执行结果
              </Button>
            ) : (
              !unavailable && (
                <>
                  {waiting ? (
                    <>
                      <Button disabled={blocked || executing} onClick={respond}>
                        在输入框回答
                      </Button>
                      {files.length > 0 && (
                        <Button
                          variant="primary"
                          icon={Play}
                          disabled={blocked || executing || files.some((f) => !ready[f.versionId])}
                          onClick={() =>
                            send({
                              action: 'RESUME',
                              expectedRevision: task.revision,
                              input: '已补充所选资料，请继续处理。',
                              originals: files.map(({ materialId, versionId }) => ({
                                materialId,
                                versionId,
                              })),
                            })
                          }
                        >
                          提交资料并继续
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button
                      icon={retry ? RotateCcw : Play}
                      disabled={blocked || executing}
                      onClick={() =>
                        send({ action: retry ? 'RETRY' : 'RESUME', expectedRevision: task.revision })
                      }
                    >
                      {task.status === 'FAILED' || task.status === 'WAITING_CAPABILITY'
                        ? '再次尝试'
                        : '继续处理'}
                    </Button>
                  )}
                </>
              )
            )}
            {['WAITING_INPUT', 'WAITING_CAPABILITY', 'PAUSED', 'RESULT_UNKNOWN'].includes(task.status) && (
              <Button
                icon={X}
                variant="ghost"
                disabled={blocked}
                onClick={() => send({ action: 'CANCEL', expectedRevision: task.revision })}
              >
                结束此项工作
              </Button>
            )}
          </>
        )}
      </div>
      {submit.error instanceof IdentityError &&
      [
        'CONVERSATION_BUSY',
        'TASK_STATE_CHANGED',
        'TASK_INPUT_LIMIT',
        'TASK_RECONCILIATION_REQUIRED',
      ].includes(submit.error.code) ? (
        <p className="access-alert" role="alert">
          {taskErrorMessage(submit.error.code)}
        </p>
      ) : (
        <SubmitError error={submit.error} uncertain={submit.uncertain} />
      )}
    </section>
  );
}
