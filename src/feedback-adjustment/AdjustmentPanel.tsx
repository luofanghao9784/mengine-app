import { useState } from 'react';
import type { FeedbackTarget } from '../../contracts/public-api/feedback';
import type { SendAdjustment } from '../../contracts/public-api/feedback-adjustment';
import { Button, Field, Modal } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { useFeedbackGuard } from '../feedback/guard';
import { useRequestLock } from '../shared/request-guard';
import { adjustmentClient } from './client';
import { conversationClient } from '../conversation/client';
import './adjustment.css';
const states: Record<string, string> = {
  QUEUED: '已排队',
  RUNNING: '正在调整',
  WAITING_CAPABILITY: '等待模型能力',
  WAITING_INPUT: '等待补充',
  PARTIAL: '部分完成',
  RESULT_UNKNOWN: '执行结果待核对',
  SUCCEEDED: '调整任务已完成',
  FAILED: '调整失败',
  CANCELLED: '已停止',
  PAUSED: '已暂停',
  INTERRUPTED: '已中断',
};
type ControlBody = {
  conversation: string;
  task: string;
  revision: number;
  action: 'RESUME' | 'CANCEL' | 'RETRY' | 'RECONCILE';
  input?: string;
};
export function AdjustmentPanel({
  tenant,
  target,
  initialRating,
  close,
}: {
  tenant: string;
  target: FeedbackTarget;
  initialRating: 'USEFUL' | 'NOT_USEFUL';
  close: () => void;
}) {
  const [text, setText] = useState(''),
    [rating, setRating] = useState<'USEFUL' | 'NOT_USEFUL'>(initialRating),
    [attempt, setAttempt] = useState(0),
    [page, setPage] = useState(0),
    [notice, setNotice] = useState(''),
    [inputs, setInputs] = useState<Record<string, string>>({});
  const submission = useSubmission<Omit<SendAdjustment, 'requestId'>>();
  const control = useSubmission<ControlBody>();
  const [lastControl, setLastControl] = useState<ControlBody>();
  const locked = submission.busy || submission.uncertain || control.busy || control.uncertain;
  useFeedbackGuard(locked);
  useRequestLock(locked);
  const data = useRemote(
    (signal) => adjustmentClient.open(tenant, target, page * 20, signal),
    [tenant, JSON.stringify(target), attempt, page],
  );
  const reload = () => setAttempt((n) => n + 1);
  const act = (body: ControlBody) => {
    setLastControl(body);
    void control.submit(body, async (b, key) => {
      await conversationClient.action(tenant, b.conversation, b.task, {
        requestId: key,
        expectedRevision: b.revision,
        action: b.action,
        ...(b.input ? { input: b.input } : {}),
      });
      const message = data.value?.items.find((m) => m.taskId === b.task);
      if (message && b.input) setInputs((v) => ({ ...v, [message.id]: '' }));
      reload();
    });
  };
  const send = () => {
    if (!data.value) return;
    void submission.submit(
      {
        target,
        expectedThreadRevision: data.value.threadRevision,
        expectedFeedbackRevision: data.value.feedbackRevision,
        message: text,
        rating,
      },
      async (body, key) => {
        const result = await adjustmentClient.send(tenant, { ...body, requestId: key });
        setText('');
        setPage(0);
        setNotice(`评价已保存，已创建真实调整任务。${states[result.message.status]}。`);
        reload();
      },
    );
  };
  return (
    <Modal
      title="这张画报的独立调整会话"
      wide
      onClose={() => {
        if (!locked) close();
      }}
    >
      <div className="adjustment-panel">
        <p className="muted">
          仅你可见。打开不提交评价；发送才保存具体建议并创建调整任务。仅调整本卡，不自动发布或保存为长期偏好。
        </p>
        {data.error ? (
          <Failure error={data.error} retry={reload} />
        ) : !data.value ? (
          <Loading />
        ) : (
          <>
            <details>
              <summary>本次实际阅读快照与来源</summary>
              <strong>{data.value.reading.title}</strong>
              <p>
                {data.value.reading.excerpt || '该卡显示独立副本标题，未把发布者私人会话或文件全文带入。'}
              </p>
              <small>
                呈现 {target.presentationVersion} / {target.presentationRevision} · 来源版本{' '}
                {data.value.reading.sourceVersions.length} ·{' '}
                {data.value.reading.truncated ? '卡片节选' : '原卡内容'}
              </small>
            </details>
            <div className="adjustment-history" aria-label="调整会话历史">
              {!data.value.items.length && (
                <p className="muted">尚无可读取的调整消息。发送后会保留每次原说明和对应快照。</p>
              )}
              {data.value.items.map((m) => (
                <article key={m.id} className="adjustment-message">
                  <p>
                    <strong>你的说明</strong> · <small>{new Date(m.createdAt).toLocaleString()}</small>
                  </p>
                  <p className="adjustment-text">{m.request}</p>
                  <small>
                    {states[m.status] || m.status} · 任务修订 {m.taskRevision}
                  </small>
                  {m.status === 'WAITING_CAPABILITY' && (
                    <p className="muted">当前未接入模型，已保存等待状态，尚未生成调整结果。</p>
                  )}
                  {m.requiredInput && (
                    <p className="adjustment-text">
                      <strong>需要补充：</strong>
                      {m.requiredInput}
                    </p>
                  )}
                  {m.supplementalInput && (
                    <p className="adjustment-text">
                      <strong>你已补充：</strong>
                      {m.supplementalInput}
                    </p>
                  )}
                  {m.reply && (
                    <div className="adjustment-reply">
                      <strong>调整结果</strong>
                      <p className="adjustment-text">{m.reply}</p>
                    </div>
                  )}
                  {['WAITING_INPUT', 'PARTIAL'].includes(m.status) && (
                    <div>
                      <Field label="补充本次调整所需信息">
                        <textarea
                          aria-label="补充本次调整所需信息"
                          value={inputs[m.id] || ''}
                          maxLength={2000}
                          disabled={locked}
                          onChange={(e) => setInputs({ ...inputs, [m.id]: e.target.value })}
                        />
                      </Field>
                      <Button
                        disabled={locked || !inputs[m.id]?.trim()}
                        onClick={() =>
                          act({
                            conversation: data.value!.conversationId!,
                            task: m.taskId,
                            revision: m.taskRevision,
                            action: 'RESUME',
                            input: inputs[m.id],
                          })
                        }
                      >
                        补充并继续当前任务
                      </Button>
                      <small>沿当前任务保存补充，不自动新增评价或改换来源。</small>
                    </div>
                  )}
                  <details>
                    <summary>这次消息绑定的快照</summary>
                    <p>{m.reading.title}</p>
                    <p>{m.reading.excerpt || '仅显示副本标题'}</p>
                    <small>
                      呈现 {m.reading.target.presentationRevision} · 已带入历史 {m.historyTaskIds.length}{' '}
                      次；旧来源不会自动换成新版。
                    </small>
                  </details>
                  {m.status === 'RESULT_UNKNOWN' && (
                    <Button
                      disabled={locked}
                      onClick={() =>
                        act({
                          conversation: data.value!.conversationId!,
                          task: m.taskId,
                          revision: m.taskRevision,
                          action: 'RECONCILE',
                        })
                      }
                    >
                      核对执行结果
                    </Button>
                  )}
                  {data.value?.conversationId &&
                    [
                      'WAITING_CAPABILITY',
                      'PAUSED',
                      'FAILED',
                      'CANCELLED',
                      'INTERRUPTED',
                      'QUEUED',
                      'RUNNING',
                    ].includes(m.status) && (
                      <div className="feedback-toolbar">
                        {['WAITING_CAPABILITY', 'PAUSED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(
                          m.status,
                        ) && (
                          <Button
                            disabled={locked}
                            onClick={() =>
                              act({
                                conversation: data.value!.conversationId!,
                                task: m.taskId,
                                revision: m.taskRevision,
                                action: ['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(m.status)
                                  ? 'RETRY'
                                  : 'RESUME',
                              })
                            }
                          >
                            重新检查执行能力
                          </Button>
                        )}
                        {['WAITING_CAPABILITY', 'PAUSED', 'QUEUED', 'RUNNING'].includes(m.status) && (
                          <Button
                            disabled={locked}
                            onClick={() =>
                              act({
                                conversation: data.value!.conversationId!,
                                task: m.taskId,
                                revision: m.taskRevision,
                                action: 'CANCEL',
                              })
                            }
                          >
                            停止这条调整任务
                          </Button>
                        )}
                      </div>
                    )}
                </article>
              ))}
            </div>
            {(page > 0 || data.value.hasMore) && (
              <Pager page={page} next={data.value.hasMore} onPage={setPage} />
            )}
            <SubmitError error={control.error} uncertain={control.uncertain} />
            {control.uncertain && lastControl && (
              <Button disabled={control.busy} onClick={() => act(lastControl)}>
                重试同次任务操作
              </Button>
            )}
            {notice && <p role="status">{notice}</p>}
            <Field label="本次画报评价">
              <select
                aria-label="本次画报评价"
                value={rating}
                disabled={locked}
                onChange={(e) => setRating(e.target.value as 'USEFUL' | 'NOT_USEFUL')}
              >
                <option value="USEFUL">有用，也想进一步优化</option>
                <option value="NOT_USEFUL">没用，提出改进建议</option>
              </select>
            </Field>
            <Field label="具体改进建议（发送后才记录）">
              <textarea
                aria-label="具体改进建议（发送后才记录）"
                rows={4}
                maxLength={2000}
                value={text}
                disabled={locked}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>
            <SubmitError error={submission.error} uncertain={submission.uncertain} />
            <div className="feedback-toolbar">
              <Button
                variant="primary"
                disabled={
                  submission.busy ||
                  control.busy ||
                  control.uncertain ||
                  (!submission.uncertain && !text.trim())
                }
                onClick={send}
              >
                {submission.uncertain ? '重试同次发送' : '发送建议并调整'}
              </Button>
              <Button disabled={locked} onClick={reload}>
                刷新当前状态
              </Button>
              <Button disabled={locked} onClick={close}>
                关闭调整会话
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
