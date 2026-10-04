import { useContext, useRef, useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import type { FeedbackAssessment, FeedbackTarget } from '../../contracts/public-api/feedback';
import { feedbackClient as api } from '../feedback/client';
import { useRemote, useSubmission, SubmitError } from '../shared/admin';
import { RequestPending, useRequestLock } from '../shared/request-guard';
import { ActionPopover } from '../shared/ActionPopover';
import { Button } from '../shared/ui';

export function ReplyFeedback({ tenant, target }: { tenant: string; target: FeedbackTarget }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [rating, setRating] = useState<'PARTIAL' | 'NOT_ACHIEVED'>('NOT_ACHIEVED');
  const [suggestion, setSuggestion] = useState('');
  const pending = useContext(RequestPending);
  const current = useRemote(
    (signal) => api.lookup(tenant, target, signal),
    [tenant, JSON.stringify(target), attempt],
  );
  const submit = useSubmission<{
    assessment: FeedbackAssessment;
    withdraw: boolean;
    id?: string;
    revision?: number;
  }>();
  const [last, setLast] = useState<Parameters<typeof submit.submit>[0]>();
  useRequestLock(submit.busy || submit.uncertain);
  const feedback = current.value?.feedback;
  const active = feedback?.status === 'ACTIVE' ? feedback.assessment.rating : null;
  const send = (body: NonNullable<typeof last>) => {
    setLast(body);
    void submit.submit(body, async (value, requestId) => {
      if (!value.id) await api.create(tenant, { requestId, target, assessment: value.assessment });
      else if (value.withdraw)
        await api.withdraw(tenant, value.id, { requestId, expectedRevision: value.revision! });
      else
        await api.edit(tenant, value.id, {
          requestId,
          expectedRevision: value.revision!,
          assessment: value.assessment,
        });
      setOpen(false);
      setAttempt((n) => n + 1);
    });
  };
  const save = (assessment: FeedbackAssessment, withdraw = false) =>
    send({ assessment, withdraw, id: feedback?.id, revision: feedback?.revision });
  const disabled = pending || submit.busy || submit.uncertain || !current.value;
  return (
    <div ref={anchor} className="reply-feedback">
      <Button
        icon={ThumbsUp}
        variant="ghost"
        aria-label="赞"
        title="已达到目的"
        aria-pressed={active === 'ACHIEVED'}
        disabled={disabled}
        onClick={() => save({ rating: 'ACHIEVED', reasons: [], suggestion: '' }, active === 'ACHIEVED')}
      />
      <Button
        icon={ThumbsDown}
        variant="ghost"
        aria-label="踩"
        title="还有改进空间"
        aria-pressed={active === 'PARTIAL' || active === 'NOT_ACHIEVED'}
        disabled={disabled}
        onClick={() => {
          setRating(active === 'PARTIAL' ? 'PARTIAL' : 'NOT_ACHIEVED');
          setSuggestion(feedback?.assessment.suggestion || '');
          setOpen(!open);
        }}
      />
      {open && (
        <ActionPopover
          anchor={anchor}
          label="改进建议"
          align="start"
          onClose={() => {
            if (!pending && !submit.uncertain) setOpen(false);
          }}
        >
          <div className="reply-feedback-panel">
            <fieldset className="reply-feedback-options">
              <legend>哪里还需要改进？</legend>
              <label className="reply-feedback-option">
                <input
                  type="radio"
                  name={`rating-${target.taskId}`}
                  checked={rating === 'PARTIAL'}
                  disabled={disabled}
                  onChange={() => setRating('PARTIAL')}
                />
                <span>部分达到目的</span>
              </label>
              <label className="reply-feedback-option">
                <input
                  type="radio"
                  name={`rating-${target.taskId}`}
                  checked={rating === 'NOT_ACHIEVED'}
                  disabled={disabled}
                  onChange={() => setRating('NOT_ACHIEVED')}
                />
                <span>没有达到目的</span>
              </label>
            </fieldset>
            <label className="reply-feedback-suggestion">
              <span>
                补充建议 <small>（可选）</small>
              </span>
              <textarea
                aria-label="改进建议（可选）"
                placeholder="例如：回答不够具体，或遗漏了关键信息"
                rows={3}
                maxLength={2000}
                value={suggestion}
                disabled={disabled}
                onChange={(e) => setSuggestion(e.target.value)}
              />
            </label>
            <footer className="reply-feedback-footer">
              {(active === 'PARTIAL' || active === 'NOT_ACHIEVED') && (
                <Button variant="ghost" disabled={disabled} onClick={() => save(feedback!.assessment, true)}>
                  撤销评价
                </Button>
              )}
              <Button
                variant="primary"
                disabled={disabled}
                onClick={() =>
                  save({ rating, reasons: suggestion.trim() ? ['OTHER'] : [], suggestion: suggestion.trim() })
                }
              >
                提交评价
              </Button>
            </footer>
          </div>
        </ActionPopover>
      )}
      {!!current.error && (
        <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
          重试读取评价
        </Button>
      )}
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      {submit.uncertain && last && (
        <Button disabled={submit.busy} onClick={() => send(last)}>
          重试本次评价
        </Button>
      )}
    </div>
  );
}
