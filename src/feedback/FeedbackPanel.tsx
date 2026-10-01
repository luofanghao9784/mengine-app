import { AdjustmentPanel } from '../feedback-adjustment/AdjustmentPanel';
import { useRequestLock } from '../shared/request-guard';
import { useCallback, useContext, useEffect, useState } from 'react';
import { MessageSquare, RefreshCw } from 'lucide-react';
import type {
  Feedback,
  FeedbackAssessment,
  FeedbackReason,
  FeedbackTarget,
} from '../../contracts/public-api/feedback';
import { useSession } from '../identity/session';
import { IdentityError } from '../identity/client';
import { Button, Field } from '../shared/ui';
import {
  Failure,
  Loading,
  MutationGate,
  Pager,
  SubmitError,
  useRemote,
  useSubmission,
} from '../shared/admin';
import { feedbackClient as api } from './client';
import { FeedbackActions } from './FeedbackActions';
import './feedback.css';
import { FeedbackLocks, FeedbackBusy, useFeedbackGuard } from './guard';
export const briefingReasons: Record<string, string> = {
  IRRELEVANT: '与当前工作无关',
  REDUNDANT: '已经知道或内容重复',
  INACCURATE: '内容不准确或已过时',
  UNHELPFUL: '分析或建议没帮助',
};
const taskReasons: Record<string, string> = {
  FACT_ERROR: '事实或数字需要核对',
  EXECUTION: '任务执行有问题',
  GOAL_CHANGED: '目标发生变化',
  EXPRESSION: '表达需要调整',
  DATA_GAP: '资料有缺口',
  OTHER: '其他原因',
};
const ratings: Record<string, string> = {
  USEFUL: '有用',
  NOT_USEFUL: '没用',
  ACHIEVED: '已达到',
  PARTIAL: '部分达到',
  NOT_ACHIEVED: '未达到',
};
export interface FeedbackPanelProps {
  tenant: string;
  target: FeedbackTarget;
  label?: string;
  verification?: unknown;
  onOpenConversation?: (conversationId: string) => void;
}
/** Insert at a meaningful delivery/detail, never after every streamed reply. Does not infer a successful task. */
export function FeedbackPanel(props: FeedbackPanelProps) {
  const { session } = useSession();
  return session.identity ? (
    <Panel
      key={`${session.identity.account.id}:${props.tenant}:${JSON.stringify(props.target)}`}
      {...props}
    />
  ) : null;
}
function Panel({ tenant, target, label, verification, onOpenConversation }: FeedbackPanelProps) {
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0),
    [expanded, setExpanded] = useState(false),
    [adjusting, setAdjusting] = useState(false),
    [adjustmentRating, setAdjustmentRating] = useState<'USEFUL' | 'NOT_USEFUL'>('NOT_USEFUL'),
    [denied, setDenied] = useState<unknown>(),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [locks, setLocks] = useState<Set<symbol>>(() => new Set());
  const blocked = busy || locks.size > 0;
  useRequestLock(blocked);
  const register = useCallback(
    (key: symbol, locked: boolean) =>
      setLocks((previous) => {
        const next = new Set(previous);
        if (locked) next.add(key);
        else next.delete(key);
        return next;
      }),
    [],
  );
  const outerGate = useContext(MutationGate);
  useEffect(() => {
    outerGate(blocked);
    return () => outerGate(false);
  }, [blocked, outerGate]);
  const onDenied = useCallback((e: unknown) => {
    if (e instanceof IdentityError && [401, 403, 404].includes(e.status) && e.code !== 'CAPABILITY_REQUIRED')
      setDenied(e);
  }, []);
  const current = useRemote(
    (signal) => api.lookup(tenant, target, signal),
    [tenant, JSON.stringify(target), attempt, verification, session.identity],
  );
  useEffect(() => {
    const focus = () => {
      if (!blocked) setAttempt((n) => n + 1);
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [blocked]);
  useEffect(() => {
    setDenied(undefined);
  }, [verification, session.identity]);
  const refresh = () => {
    setDenied(undefined);
    setAttempt((n) => n + 1);
  };
  if (denied || current.error)
    return (
      <section className="feedback-panel">
        <Failure error={denied || current.error} retry={refresh} />
      </section>
    );
  if (!current.value)
    return (
      <section className="feedback-panel">
        <Loading />
      </section>
    );
  const f = current.value.feedback;
  return (
    <MutationGate.Provider value={setBusy}>
      <FeedbackLocks.Provider value={register}>
        <FeedbackBusy.Provider value={blocked}>
          <section
            className="feedback-panel"
            data-feedback-kind={target.kind}
            data-task-id={target.taskId || undefined}
            data-publication-id={target.publicationId || undefined}
          >
            <div className="feedback-heading">
              <div>
                <h4>{target.kind !== 'TASK' ? '这条画报对你有用吗？' : '本次工作是否达到你的目的？'}</h4>
                {label && <p>{label}</p>}
                <small>
                  {target.kind === 'PUBLICATION'
                    ? `独立企业副本 · 资料版本 ${target.materialVersion} · 呈现 ${target.presentationRevision}`
                    : `对应第 ${target.attempt} 次执行 · 任务版本 ${target.taskRevision}`}
                  {f && ` · 评价修订 ${f.revision}`}
                </small>
              </div>
              <div className="feedback-toolbar">
                <Button icon={MessageSquare} disabled={blocked} onClick={() => setExpanded(!expanded)}>
                  {expanded
                    ? '收起评价'
                    : f?.status === 'ACTIVE'
                      ? `我的评价：${ratings[f.assessment.rating]}`
                      : '评价 / 建议'}
                </Button>
                <Button icon={RefreshCw} disabled={blocked} aria-label="刷新评价" onClick={refresh} />
              </div>
            </div>
            {notice && (
              <p className="feedback-notice" role="status">
                {notice}
              </p>
            )}
            {f?.status === 'WITHDRAWN' && (
              <p className="feedback-muted">
                评价已撤回。另行明确设置的偏好、已创建的任务和候选保留各自状态。
              </p>
            )}
            {expanded && (
              <>
                <FeedbackForm
                  key={f ? `${f.id}:${f.revision}` : 'new'}
                  tenant={tenant}
                  target={target}
                  feedback={f}
                  openAdjustment={(rating) => {
                    setAdjustmentRating(rating);
                    setAdjusting(true);
                  }}
                  changed={(message) => {
                    setNotice(message);
                    refresh();
                  }}
                  onDenied={onDenied}
                />
                {f && (
                  <>
                    <FeedbackHistory tenant={tenant} feedback={f} onDenied={onDenied} />
                    <FeedbackActions
                      tenant={tenant}
                      feedback={f}
                      onDenied={onDenied}
                      onOpenConversation={onOpenConversation}
                    />
                  </>
                )}
              </>
            )}
            {adjusting && (
              <AdjustmentPanel
                tenant={tenant}
                target={target}
                initialRating={adjustmentRating}
                close={() => {
                  setAdjusting(false);
                  refresh();
                }}
              />
            )}
          </section>
        </FeedbackBusy.Provider>
      </FeedbackLocks.Provider>
    </MutationGate.Provider>
  );
}
function FeedbackForm({
  openAdjustment,
  tenant,
  target,
  feedback,
  changed,
  onDenied,
}: {
  tenant: string;
  target: FeedbackTarget;
  feedback: Feedback | null;
  openAdjustment: (rating: 'USEFUL' | 'NOT_USEFUL') => void;
  changed: (message: string) => void;
  onDenied: (e: unknown) => void;
}) {
  const [assessment, setAssessment] = useState<FeedbackAssessment>(
      feedback?.assessment || {
        rating: target.kind !== 'TASK' ? 'USEFUL' : 'ACHIEVED',
        reasons: [],
        suggestion: '',
      },
    ),
    [negative, setNegative] = useState(feedback?.assessment.rating === 'NOT_USEFUL');
  const submit = useSubmission<{
    assessment: FeedbackAssessment;
    withdraw: boolean;
    feedbackId?: string;
    expectedRevision?: number;
  }>();
  const locked = submit.busy || submit.uncertain;
  useFeedbackGuard(locked);
  const globallyBlocked = useContext(FeedbackBusy);
  const save = (next: FeedbackAssessment, withdraw = false) =>
    void submit.submit(
      { assessment: next, withdraw, feedbackId: feedback?.id, expectedRevision: feedback?.revision },
      async (b, key) => {
        try {
          if (b.feedbackId) {
            if (b.withdraw)
              await api.withdraw(tenant, b.feedbackId, {
                requestId: key,
                expectedRevision: b.expectedRevision!,
              });
            else
              await api.edit(tenant, b.feedbackId, {
                requestId: key,
                expectedRevision: b.expectedRevision!,
                assessment: b.assessment,
              });
          } else await api.create(tenant, { requestId: key, target, assessment: b.assessment });
          changed(
            b.withdraw
              ? '评价已撤回；未自动撤销独立确认的后续动作。'
              : '评价已保存。尚未自动修改内容、偏好或经验。',
          );
        } catch (e) {
          onDenied(e);
          throw e;
        }
      },
    );
  return (
    <div className="feedback-form">
      <div className="feedback-ratings">
        {(target.kind !== 'TASK' ? ['USEFUL', 'NOT_USEFUL'] : ['ACHIEVED', 'PARTIAL', 'NOT_ACHIEVED']).map(
          (value) => (
            <Button
              key={value}
              disabled={locked || globallyBlocked}
              variant={assessment.rating === value ? 'primary' : 'secondary'}
              onClick={() => {
                const next = {
                  rating: value as FeedbackAssessment['rating'],
                  reasons: [],
                  suggestion: assessment.suggestion,
                };
                setAssessment(next);
                if (value === 'NOT_USEFUL') {
                  setNegative(true);
                } else {
                  setNegative(false);
                  save(next);
                }
              }}
            >
              {ratings[value]}
            </Button>
          ),
        )}
      </div>
      {target.kind !== 'TASK' && negative && (
        <>
          <p className="feedback-muted">选择快捷原因即保存；仅打开面板不会改评。</p>
          <div className="feedback-reasons">
            {Object.entries(briefingReasons).map(([value, label]) => (
              <Button
                key={value}
                variant={assessment.reasons.includes(value as FeedbackReason) ? 'primary' : 'secondary'}
                disabled={locked || globallyBlocked}
                onClick={() => {
                  const next = {
                    ...assessment,
                    rating: 'NOT_USEFUL' as const,
                    reasons: [value as FeedbackReason],
                  };
                  setAssessment(next);
                  save(next);
                }}
              >
                {label}
              </Button>
            ))}
            <Button disabled={locked || globallyBlocked} onClick={() => openAdjustment('NOT_USEFUL')}>
              告诉 AI 如何优化 / 继续调整会话
            </Button>
          </div>
        </>
      )}
      {target.kind === 'TASK' && (
        <div className="feedback-reasons">
          {Object.entries(taskReasons).map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                disabled={locked || globallyBlocked}
                checked={assessment.reasons.includes(value as FeedbackReason)}
                onChange={(e) =>
                  setAssessment({
                    ...assessment,
                    reasons: e.target.checked
                      ? [...assessment.reasons, value as FeedbackReason]
                      : assessment.reasons.filter((r) => r !== value),
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      )}
      {target.kind === 'TASK' && (
        <Field label="补充原因或改进建议">
          <textarea
            aria-label="补充原因或改进建议"
            maxLength={2000}
            rows={3}
            disabled={locked || globallyBlocked}
            value={assessment.suggestion}
            onChange={(e) => setAssessment({ ...assessment, suggestion: e.target.value })}
          />
        </Field>
      )}
      <p className="feedback-muted">仅本人及当前源权限可见。评价不改变权限、关注、隐藏或任务执行状态。</p>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      <div className="feedback-toolbar">
        {(target.kind === 'TASK' || submit.uncertain) && (
          <Button
            variant="primary"
            disabled={
              submit.busy ||
              (globallyBlocked && !submit.uncertain) ||
              (assessment.rating === 'NOT_USEFUL' &&
                ((!assessment.reasons.length && !assessment.suggestion.trim()) ||
                  (assessment.reasons.includes('CUSTOM') && !assessment.suggestion.trim())))
            }
            onClick={() => save(assessment)}
          >
            {submit.uncertain
              ? '重试同次提交'
              : feedback?.status === 'WITHDRAWN'
                ? '重新提交评价'
                : '保存评价与建议'}
          </Button>
        )}
        {feedback?.status === 'ACTIVE' && (
          <Button disabled={locked || globallyBlocked} onClick={() => save(assessment, true)}>
            撤回评价
          </Button>
        )}
      </div>
    </div>
  );
}
function FeedbackHistory({
  tenant,
  feedback,
  onDenied,
}: {
  tenant: string;
  feedback: Feedback;
  onDenied: (e: unknown) => void;
}) {
  const [show, setShow] = useState(false),
    [page, setPage] = useState(0);
  const data = useRemote(
    (signal) =>
      show
        ? api.history(tenant, feedback.id, feedback.target.kind, page * 20, signal)
        : Promise.resolve(null),
    [tenant, feedback.id, feedback.revision, show, page],
  );
  useEffect(() => {
    if (data.error) onDenied(data.error);
  }, [data.error, onDenied]);
  return (
    <div className="feedback-history">
      <Button variant="ghost" onClick={() => setShow(!show)}>
        {show ? '收起评价历史' : '查看改评与撤回历史'}
      </Button>
      {show &&
        (data.error ? (
          <Failure error={data.error} retry={() => setShow(false)} />
        ) : !data.value ? (
          <Loading />
        ) : (
          <>
            <ul>
              {data.value.items.map((v) => (
                <li key={v.revision}>
                  <strong>
                    修订 {v.revision} · {v.status === 'WITHDRAWN' ? '已撤回' : ratings[v.assessment.rating]}
                  </strong>
                  <small>{new Date(v.createdAt).toLocaleString('zh-CN')}</small>
                  {v.assessment.reasons.length > 0 && (
                    <p>
                      {v.assessment.reasons
                        .map((reason) => briefingReasons[reason] || taskReasons[reason] || '具体改进建议')
                        .join('；')}
                    </p>
                  )}
                  <p>{v.assessment.suggestion || '未补充说明'}</p>
                </li>
              ))}
            </ul>
            <Pager page={page} next={data.value.hasMore} onPage={setPage} />
          </>
        ))}
    </div>
  );
}
