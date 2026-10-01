import { ExperienceBusyContext, useExperienceGuard } from './useExperienceGuard';
import { useContext, useEffect, useState } from 'react';
import type {
  Applicability,
  ExperienceEntry,
  ExperienceFeedback,
  ExperienceUse,
  ExperienceUseInput,
} from '../../contracts/public-api/experience';
import { Button, Field } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { experienceClient as api } from './client';
const decisions: Record<Applicability, string> = {
  DIRECT: '条件相符，可直接参考',
  ADAPTED: '需要调整后参考',
  UNKNOWN: '条件未知，暂不采用',
  NOT_APPLICABLE: '不适用，跳过',
};
const results: Record<ExperienceFeedback['result'], string> = {
  UNKNOWN: '结果尚未知',
  COMPLETED: '自述已完成',
  FAILED: '未完成或失败',
  CORRECTED: '经人工纠正',
};
const stamp = (s: string) => new Date(s).toLocaleString('zh-CN', { hour12: false });
export function ExperienceUsePanel({
  tenant,
  workspace,
  entry,
  onDenied,
}: {
  tenant: string;
  workspace: string;
  entry: ExperienceEntry;
  onDenied: (e: unknown) => void;
}) {
  const blocked = useContext(ExperienceBusyContext);
  const [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0),
    [form, setForm] = useState(false);
  const uses = useRemote(
    (signal) => api.uses(tenant, workspace, entry.id, page * 20, signal),
    [tenant, workspace, entry.id, page, attempt],
  );
  useEffect(() => {
    if (uses.error) onDenied(uses.error);
  }, [uses.error, onDenied]);
  const current = entry.status === 'PUBLISHED' && entry.publishedVersion === entry.version.id;
  return (
    <section className="experience-uses">
      <div className="experience-section-head">
        <h3>我的使用与后续案例记录</h3>
        {current && (
          <Button disabled={blocked} onClick={() => setForm(!form)}>
            {form ? '收起记录表' : '判断适用并记录'}
          </Button>
        )}
      </div>
      <p className="experience-note">
        记录仅本人可见，不自动发布为共享案例。检索命中不等于采用，自述结果不等于评测或业务成功；空库或不适用时可继续原工作。
      </p>
      {form && current && (
        <UseForm
          tenant={tenant}
          workspace={workspace}
          entry={entry}
          saved={() => {
            setForm(false);
            setAttempt((n) => n + 1);
          }}
          onDenied={onDenied}
        />
      )}
      {uses.error ? (
        <Failure error={uses.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !uses.value ? (
        <Loading />
      ) : (
        <>
          {uses.value.items.map((u) => (
            <UseRecord
              key={u.id}
              tenant={tenant}
              workspace={workspace}
              entry={entry.id}
              use={u}
              onDenied={onDenied}
            />
          ))}
          {!uses.value.items.length && (
            <p className="experience-note">还没有使用记录。阅读经验无需强制登记。</p>
          )}
          <Pager page={page} next={uses.value.hasMore} onPage={setPage} />
        </>
      )}
    </section>
  );
}
function UseForm({
  tenant,
  workspace,
  entry,
  saved,
  onDenied,
}: {
  tenant: string;
  workspace: string;
  entry: ExperienceEntry;
  saved: () => void;
  onDenied: (e: unknown) => void;
}) {
  const [contextKey, setContext] = useState(''),
    [decision, setDecision] = useState<Applicability>('UNKNOWN'),
    [adopted, setAdopted] = useState(false),
    [conditions, setConditions] = useState(''),
    [adjustments, setAdjustments] = useState('');
  const submit = useSubmission<ExperienceUseInput>();
  const locked = submit.busy || submit.uncertain;
  useExperienceGuard(locked);
  return (
    <form
      className="experience-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit.submit(
          {
            versionId: entry.version.id,
            taskId: null,
            contextKey,
            decision,
            adopted,
            conditions,
            adjustments,
          },
          async (use, key) => {
            try {
              await api.use(tenant, workspace, entry.id, { requestId: key, use });
              saved();
            } catch (error) {
              onDenied(error);
              throw error;
            }
          },
        );
      }}
    >
      <p>固定记录 v{entry.version.number} · 后续更新不改变本次方法版本</p>
      <Field label="本次工作或案例标识" hint="同一工作请使用同一标识，后续结果补充到原记录。">
        <input
          required
          maxLength={100}
          disabled={locked}
          value={contextKey}
          onChange={(e) => setContext(e.target.value)}
        />
      </Field>
      <Field label="适用判断">
        <select
          aria-label="适用判断"
          disabled={locked}
          value={decision}
          onChange={(e) => {
            setDecision(e.target.value as Applicability);
            setAdopted(false);
          }}
        >
          {Object.entries(decisions).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="本次条件及判断依据">
        <textarea
          required
          rows={3}
          maxLength={2000}
          disabled={locked}
          value={conditions}
          onChange={(e) => setConditions(e.target.value)}
        />
      </Field>
      <Field label="必要调整与未验证范围">
        <textarea
          rows={2}
          maxLength={2000}
          disabled={locked}
          value={adjustments}
          onChange={(e) => setAdjustments(e.target.value)}
        />
      </Field>
      <label className="experience-checkbox">
        <input
          type="checkbox"
          disabled={locked || !['DIRECT', 'ADAPTED'].includes(decision)}
          checked={adopted}
          onChange={(e) => setAdopted(e.target.checked)}
        />
        实际采用了此方法（仅适用时勾选）
      </label>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      <Button type="submit" variant="primary" disabled={submit.busy}>
        {submit.uncertain ? '重试同次记录' : '保存我的使用判断'}
      </Button>
    </form>
  );
}
function UseRecord({
  tenant,
  workspace,
  entry,
  use,
  onDenied,
}: {
  tenant: string;
  workspace: string;
  entry: string;
  use: ExperienceUse;
  onDenied: (e: unknown) => void;
}) {
  const blocked = useContext(ExperienceBusyContext);
  const [expanded, setExpanded] = useState(false),
    [page, setPage] = useState(0),
    [attempt, setAttempt] = useState(0),
    [result, setResult] = useState<ExperienceFeedback['result']>('UNKNOWN'),
    [note, setNote] = useState('');
  const submit = useSubmission<{ result: ExperienceFeedback['result']; note: string }>();
  useExperienceGuard(submit.busy || submit.uncertain);
  const feedbacks = useRemote(
    (signal) =>
      expanded ? api.feedbacks(tenant, workspace, entry, use.id, page * 20, signal) : Promise.resolve(null),
    [tenant, workspace, entry, use.id, expanded, page, attempt],
  );
  useEffect(() => {
    if (feedbacks.error) onDenied(feedbacks.error);
  }, [feedbacks.error, onDenied]);
  return (
    <article className="experience-use-card">
      <div className="experience-section-head">
        <strong>{use.contextKey}</strong>
        <span>{stamp(use.createdAt)}</span>
      </div>
      <p>
        {decisions[use.decision]} · {use.adopted ? '已实际采用' : '未采用'}
      </p>
      <p>{use.conditions}</p>
      {use.adjustments && <p>调整：{use.adjustments}</p>}
      <small>方法版本 ID：{use.versionId}</small>
      <Button disabled={blocked} onClick={() => setExpanded(!expanded)}>
        {expanded ? '收起后续记录' : '查看 / 补充后续结果'}
      </Button>
      {expanded && (
        <>
          {feedbacks.error ? (
            <Failure error={feedbacks.error} retry={() => setAttempt((n) => n + 1)} />
          ) : !feedbacks.value ? (
            <Loading />
          ) : (
            <>
              <ul className="experience-feedback-list">
                {feedbacks.value.items.map((f) => (
                  <li key={f.id}>
                    <strong>{results[f.result]}</strong>
                    <time>{stamp(f.createdAt)}</time>
                    <p>{f.note}</p>
                  </li>
                ))}
              </ul>
              <Pager page={page} next={feedbacks.value.hasMore} onPage={setPage} />
            </>
          )}
          <form
            className="experience-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit.submit({ result, note }, async (b, key) => {
                try {
                  await api.feedback(tenant, workspace, entry, use.id, { requestId: key, ...b });
                  setNote('');
                  setAttempt((n) => n + 1);
                } catch (error) {
                  onDenied(error);
                  throw error;
                }
              });
            }}
          >
            <Field label="后续结果">
              <select
                aria-label="后续结果"
                disabled={submit.busy || submit.uncertain}
                value={result}
                onChange={(e) => setResult(e.target.value as ExperienceFeedback['result'])}
              >
                {Object.entries(results).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="结果依据、人工贡献与待观察事项">
              <textarea
                required
                maxLength={2000}
                rows={3}
                disabled={submit.busy || submit.uncertain}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <SubmitError error={submit.error} uncertain={submit.uncertain} />
            <Button type="submit" disabled={submit.busy}>
              {submit.uncertain ? '重试同次补充' : '补充后续记录'}
            </Button>
          </form>
        </>
      )}
    </article>
  );
}
