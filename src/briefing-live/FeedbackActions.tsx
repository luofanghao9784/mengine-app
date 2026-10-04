import { feedbackChangedEvent } from './FeedbackMark';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ThumbsUp, ThumbsDown, X } from 'lucide-react';
import type { FeedbackAssessment, FeedbackTarget } from '../../contracts/public-api/feedback';
import { NavIconButton, useNavHover, useNavLabelSide } from '../components/NavIconButton';
import { feedbackClient as api } from '../feedback/client';
import { AdjustmentPanel } from '../feedback-adjustment/AdjustmentPanel';
import { RequestPending, requestNavigationLocked, useRequestLock } from '../shared/request-guard';
import { Button } from '../shared/ui';
import { SubmitError, useRemote, useSubmission } from '../shared/admin';
import { ActionPopover } from '../shared/ActionPopover';

const reasons = [
  ['IRRELEVANT', '与我无关'],
  ['REDUNDANT', '内容重复'],
  ['INACCURATE', '信息不准确'],
  ['UNHELPFUL', '没有帮助'],
] as const;
type Change = { assessment: FeedbackAssessment; id?: string; revision?: number; withdraw: boolean };

/** One controller owns the version-bound feedback in either the card or reader rail. */
export function FeedbackActions({
  tenant,
  target,
  children,
}: {
  tenant: string;
  target: FeedbackTarget;
  children?: ReactNode;
}) {
  const rail = useRef<HTMLDivElement>(null),
    negative = useRef<HTMLDivElement>(null);
  const { expanded, interaction } = useNavHover(rail, JSON.stringify(target));
  const side = useNavLabelSide(rail);
  const [panel, setPanel] = useState<'reasons' | 'custom' | 'adjust' | null>(null);
  const [suggestion, setSuggestion] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState('');
  const restoreFeedbackFocus = useRef<{ label: string; revision: number } | undefined>(undefined);
  const pending = useContext(RequestPending);
  const lookup = useRemote(
    (signal) => api.lookup(tenant, target, signal),
    [tenant, JSON.stringify(target), attempt],
  );
  const submission = useSubmission<Change>();
  const [last, setLast] = useState<Change>();
  const locked = submission.busy || submission.uncertain;
  useRequestLock(locked);
  const feedback = lookup.value?.feedback,
    active = feedback?.status === 'ACTIVE' ? feedback.assessment : null;
  const refresh = () => setAttempt((n) => n + 1);
  const send = (change: Change) => {
    setLast(change);
    void submission.submit(change, async (body, requestId) => {
      if (!body.id) await api.create(tenant, { requestId, target, assessment: body.assessment });
      else if (body.withdraw)
        await api.withdraw(tenant, body.id, { requestId, expectedRevision: body.revision! });
      else
        await api.edit(tenant, body.id, {
          requestId,
          expectedRevision: body.revision!,
          assessment: body.assessment,
        });
      restoreFeedbackFocus.current = {
        label: body.assessment.rating === 'USEFUL' ? '有用' : '没用',
        revision: (body.revision || 0) + 1,
      };
      window.dispatchEvent(new CustomEvent(feedbackChangedEvent, { detail: { tenant } }));
      setPanel(null);
      setNotice(body.withdraw ? '已撤销反馈' : '已收到反馈');
      refresh();
    });
  };
  const save = (assessment: FeedbackAssessment, withdraw = false) =>
    send({ assessment, withdraw, id: feedback?.id, revision: feedback?.revision });
  useEffect(() => {
    const restore = restoreFeedbackFocus.current;
    if (!restore || pending || locked || (lookup.value?.feedback?.revision || 0) < restore.revision) return;
    const button = rail.current?.querySelector<HTMLButtonElement>(`button[aria-label="${restore.label}"]`);
    if (!button || button.disabled) return;
    button.focus({ preventScroll: true });
    restoreFeedbackFocus.current = undefined;
  }, [lookup.value, locked, pending]);
  const disabled = pending || locked || !lookup.value;
  const close = () => {
    if (!locked && !requestNavigationLocked()) {
      setPanel(null);
    }
  };
  return (
    <>
      <div ref={rail} className="live-feedback-actions" data-label-side={side} aria-label="卡片快捷操作">
        <NavIconButton
          label="有用"
          Icon={ThumbsUp}
          active={active?.rating === 'USEFUL'}
          aria-pressed={active?.rating === 'USEFUL'}
          expanded={expanded === 'useful'}
          interaction={interaction('useful')}
          disabled={disabled}
          onClick={() => save({ rating: 'USEFUL', reasons: [], suggestion: '' }, active?.rating === 'USEFUL')}
        />
        <div ref={negative} className="live-negative-action">
          <NavIconButton
            label="没用"
            Icon={ThumbsDown}
            active={active?.rating === 'NOT_USEFUL'}
            aria-pressed={active?.rating === 'NOT_USEFUL'}
            expanded={expanded === 'negative'}
            interaction={interaction('negative')}
            disabled={disabled}
            aria-expanded={panel === 'reasons'}
            onClick={() => setPanel(panel === 'reasons' ? null : 'reasons')}
          />
          {(panel === 'reasons' || panel === 'custom') && (
            <ActionPopover anchor={negative} label="选择没用的原因" onClose={close}>
              <header>
                <strong>哪里没帮到你？</strong>
                <Button icon={X} aria-label="取消选择原因" disabled={locked} onClick={close} />
              </header>
              {panel === 'reasons' ? (
                <>
                  {reasons.map(([reason, label]) => (
                    <button
                      type="button"
                      key={reason}
                      disabled={disabled}
                      aria-pressed={active?.reasons.includes(reason)}
                      onClick={() => save({ rating: 'NOT_USEFUL', reasons: [reason], suggestion: '' })}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setSuggestion(active?.suggestion || '');
                      setPanel('custom');
                    }}
                  >
                    其他原因
                  </button>
                  <button type="button" disabled={disabled} onClick={() => setPanel('adjust')}>
                    告诉 AI 如何优化
                  </button>
                  {active && (
                    <button type="button" disabled={disabled} onClick={() => save(active, true)}>
                      撤销反馈
                    </button>
                  )}
                </>
              ) : (
                <>
                  <textarea
                    aria-label="改进建议"
                    value={suggestion}
                    maxLength={2000}
                    disabled={locked}
                    rows={4}
                    onChange={(e) => setSuggestion(e.target.value)}
                  />
                  <Button
                    disabled={disabled || !suggestion.trim()}
                    onClick={() =>
                      save({ rating: 'NOT_USEFUL', reasons: ['CUSTOM'], suggestion: suggestion.trim() })
                    }
                  >
                    提交建议
                  </Button>
                </>
              )}
              <SubmitError error={submission.error} uncertain={submission.uncertain} />
              {submission.uncertain && last && (
                <Button disabled={submission.busy} onClick={() => send(last)}>
                  重试本次评价
                </Button>
              )}
            </ActionPopover>
          )}
        </div>
        {children}
      </div>
      {notice && (
        <span className="live-feedback-receipt" role="status">
          {notice}
        </span>
      )}
      {(lookup.error || (submission.error && !panel)) && (
        <div className="live-feedback-error" role="alert">
          <span>{lookup.error ? '评价暂时无法读取' : '评价未确认保存'}</span>
          <Button
            disabled={submission.busy}
            onClick={() => (submission.uncertain && last ? send(last) : refresh())}
          >
            {submission.uncertain ? '重试本次评价' : '重新读取评价'}
          </Button>
        </div>
      )}
      {panel === 'adjust' && (
        <AdjustmentPanel
          tenant={tenant}
          target={target}
          initialRating="NOT_USEFUL"
          close={() => {
            setPanel(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
