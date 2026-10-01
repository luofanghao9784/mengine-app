import { FeedbackBusy, useFeedbackGuard } from './guard';
import { useContext, useEffect, useState } from 'react';
import type {
  Feedback,
  FeedbackAction,
  FeedbackFollowUp,
  PreferenceScenario,
  PreferenceStyle,
} from '../../contracts/public-api/feedback';
import { Button, Field } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { feedbackClient as api } from './client';
const scenarios: Record<PreferenceScenario, string> = {
  GENERAL: '一般工作内容',
  WEEKLY_REPORT: '周报',
  TABLE_SUMMARY: '表格汇总',
};
const styles: Record<PreferenceStyle, string> = {
  CONCLUSION_FIRST: '先给结论，再给依据',
  DETAIL_FIRST: '先交代依据，再给结论',
  TABLE_FIRST: '适合比较时优先表格',
  CONCISE: '简洁且保留必要事实与限制',
};
const kindLabels = {
  PREFERENCE: '设置个人表达偏好',
  CORRECTION: '创建本次纠正任务',
};
export function FeedbackActions({
  tenant,
  feedback,
  onDenied,
  onOpenConversation,
}: {
  tenant: string;
  feedback: Feedback;
  onDenied: (e: unknown) => void;
  onOpenConversation?: (id: string) => void;
}) {
  const globallyBlocked = useContext(FeedbackBusy);
  const [kind, setKind] = useState<keyof typeof kindLabels>(),
    [attempt, setAttempt] = useState(0),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false);
  const actions = useRemote(
    (signal) => api.actions(tenant, feedback.id, page * 20, signal),
    [tenant, feedback.id, feedback.revision, page, attempt],
  );
  useEffect(() => {
    if (actions.error) onDenied(actions.error);
  }, [actions.error, onDenied]);
  return (
    <section className="feedback-actions">
      <h4>需要进一步处理时，明确选择动作</h4>
      <p className="feedback-muted">
        保存评价不会自动执行以下操作。每项动作有独立回执，模型关闭时也如实显示等待能力。
      </p>
      {feedback.target.kind === 'PUBLICATION' && (
        <p className="feedback-muted">
          评价仅自己可见。纠正会新建你自己的私人任务，不会修改共享事实或开放发布者的私人会话。
        </p>
      )}
      {feedback.status === 'ACTIVE' && (
        <div className="feedback-toolbar">
          {Object.entries(kindLabels).map(([value, label]) => (
            <Button
              key={value}
              disabled={busy || globallyBlocked}
              variant={kind === value ? 'primary' : 'secondary'}
              onClick={() => setKind(kind === value ? undefined : (value as keyof typeof kindLabels))}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
      {kind && feedback.status === 'ACTIVE' && (
        <ActionForm
          key={kind + feedback.revision}
          tenant={tenant}
          feedback={feedback}
          kind={kind}
          onDenied={onDenied}
          setBusy={setBusy}
          saved={() => {
            setKind(undefined);
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {actions.error ? (
        <Failure error={actions.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !actions.value ? (
        <Loading />
      ) : (
        <>
          <ul className="feedback-receipts">
            {actions.value.items
              .filter((action) => action.kind !== 'EXPERIENCE_CANDIDATE')
              .map((action) => (
                <Receipt key={action.id} action={action} onOpenConversation={onOpenConversation} />
              ))}
          </ul>
          <Pager page={page} next={actions.value.hasMore} onPage={setPage} />
        </>
      )}
    </section>
  );
}
function ActionForm({
  tenant,
  feedback,
  kind,
  onDenied,
  setBusy,
  saved,
}: {
  tenant: string;
  feedback: Feedback;
  kind: keyof typeof kindLabels;
  onDenied: (e: unknown) => void;
  setBusy: (busy: boolean) => void;
  saved: () => void;
}) {
  const [scenario, setScenario] = useState<PreferenceScenario>('GENERAL'),
    [style, setStyle] = useState<PreferenceStyle>('CONCLUSION_FIRST'),
    [correction, setCorrection] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [refresh, setRefresh] = useState(0);
  const preferences = useRemote(
    (signal) => (kind === 'PREFERENCE' ? api.preferences(tenant, signal) : Promise.resolve(null)),
    [tenant, kind, refresh],
  );
  const submit = useSubmission<FeedbackFollowUp>();
  const locked = submit.busy || submit.uncertain;
  const globallyBlocked = useContext(FeedbackBusy);
  useFeedbackGuard(locked);
  useEffect(() => {
    if (locked) {
      setBusy(true);

      return () => {
        setBusy(false);
      };
    }
  }, [locked, setBusy]);
  useEffect(() => {
    if (preferences.error) onDenied(preferences.error);
  }, [preferences.error, onDenied]);
  const current = preferences.value?.items.find((p) => p.scenario === scenario);
  return (
    <form
      className="feedback-action-form"
      onSubmit={(e) => {
        e.preventDefault();
        const body: FeedbackFollowUp =
          kind === 'PREFERENCE'
            ? {
                kind,
                confirmed: true,
                preference: { scenario, style, expectedProfileRevision: current!.revision },
                correction: null,
                candidate: null,
              }
            : { kind, confirmed: true, preference: null, correction, candidate: null };
        void submit.submit(body, async (action, key) => {
          try {
            await api.followUp(tenant, feedback.id, {
              requestId: key,
              expectedRevision: feedback.revision,
              action,
            });
            saved();
          } catch (error) {
            onDenied(error);
            throw error;
          }
        });
      }}
    >
      {kind === 'PREFERENCE' ? (
        <>
          {preferences.error ? (
            <Failure error={preferences.error} retry={() => setRefresh((n) => n + 1)} />
          ) : !preferences.value ? (
            <Loading />
          ) : (
            <>
              <Field label="偏好场景">
                <select
                  aria-label="偏好场景"
                  disabled={locked || globallyBlocked}
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as PreferenceScenario)}
                >
                  {Object.entries(scenarios).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="表达偏好">
                <select
                  aria-label="表达偏好"
                  disabled={locked || globallyBlocked}
                  value={style}
                  onChange={(e) => setStyle(e.target.value as PreferenceStyle)}
                >
                  {Object.entries(styles).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="feedback-muted">
                当前：
                {current?.status === 'UNSET'
                  ? '尚未设置'
                  : `档案版本 ${current?.revision} · ${current?.style ? styles[current.style] : '已另行编辑的偏好'}`}
                。仅写入本人档案中的明确选项，不复制评价文本或源资料。
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <Field label="明确的本次纠正要求">
            <textarea
              required
              maxLength={1200}
              rows={4}
              disabled={locked || globallyBlocked}
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
            />
          </Field>
          <p className="feedback-muted">
            {feedback.target.kind === 'PUBLICATION'
              ? `将在你的个人空间建立独立私人会话，只关联这份发布副本的资料版本 ${feedback.target.materialVersion}。`
              : `将建立独立私人会话，关联原任务第 ${feedback.target.attempt} 次执行、版本 ${feedback.target.taskRevision} 的来源。`}
            创建任务不等于原内容已修改，不自动覆盖新的成果。
          </p>
        </>
      )}
      <label className="feedback-confirm">
        <input
          type="checkbox"
          required
          checked={confirmed}
          disabled={locked || globallyBlocked}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        我明确要求执行“{kindLabels[kind]}”，这项决定独立于评分。
      </label>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      <Button
        type="submit"
        variant="primary"
        disabled={
          submit.busy ||
          (globallyBlocked && !submit.uncertain) ||
          !confirmed ||
          (kind === 'PREFERENCE' && !current)
        }
      >
        {submit.uncertain ? '重试同次后续动作' : '确认并执行所选动作'}
      </Button>
    </form>
  );
}
function Receipt({
  action,
  onOpenConversation,
}: {
  action: FeedbackAction;
  onOpenConversation?: (id: string) => void;
}) {
  const blocked = useContext(FeedbackBusy);
  if (action.kind === 'EXPERIENCE_CANDIDATE') return null;
  return (
    <li>
      <div className="feedback-receipt-title">
        <strong>{kindLabels[action.kind]}</strong>
        <small>
          评价修订 {action.feedbackRevision} · {new Date(action.createdAt).toLocaleString('zh-CN')}
        </small>
      </div>
      <p>
        {action.kind === 'PREFERENCE'
          ? `已写入个人偏好档案 v${action.targetRevision}`
          : `独立纠正任务已建立；接收时状态：${action.acceptedState === 'WAITING_CAPABILITY' ? '等待模型或执行能力' : action.acceptedState}。请进入任务查看当前进展。`}
      </p>
      {action.executionClass === 'verification' && (
        <p className="feedback-muted">来源属于合成验证，不能作为真实业务成功证据。</p>
      )}
      <small className="feedback-target-id">目标 ID：{action.targetId}</small>
      {action.conversationId && onOpenConversation && (
        <Button disabled={blocked} onClick={() => onOpenConversation(action.conversationId!)}>
          查看纠正会话
        </Button>
      )}
    </li>
  );
}
