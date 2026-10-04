import { useEffect, useState } from 'react';
import type { GeneralExperienceAdjustmentChange } from '../../contracts/public-api/general-experience';
import { IdentityError } from '../identity/client';
import { Badge, Button, Field } from '../shared/ui';
import { Failure, Loading, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { requestNavigationLocked, useRequestLock } from '../shared/request-guard';
import { generalExperienceClient as api, generalAdjustmentLabels } from './general-client';
const pendingStates = new Set(['QUEUED', 'RETRY_WAIT', 'RUNNING', 'UNCERTAIN', 'PUBLISHING']);
type Form = Omit<GeneralExperienceAdjustmentChange, 'requestId'>;
export function PlatformExperienceAdjustmentPanel({
  entry,
  version,
  locked,
  denied,
  chooseVersion,
}: {
  entry: string;
  version: string;
  locked: (value: boolean) => void;
  denied: (error: unknown) => void;
  chooseVersion: (version: string) => void;
}) {
  const [attempt, setAttempt] = useState(0),
    [form, setForm] = useState<Form | null>(null);
  const submission = useSubmission<Form>();
  const blocked = submission.busy || submission.uncertain;
  useRequestLock(blocked);
  useEffect(() => {
    locked(blocked);
    return () => locked(false);
  }, [blocked, locked]);
  const data = useRemote((signal) => api.adjustments(entry, version, signal), [entry, version, attempt]);
  const d = data.value;
  useEffect(() => {
    const e = data.error || submission.error;
    if (e instanceof IdentityError && [401, 403, 404].includes(e.status)) denied(e);
  }, [data.error, submission.error, denied]);
  useEffect(() => {
    if (submission.error instanceof IdentityError && submission.error.status === 409)
      setAttempt((n) => n + 1);
  }, [submission.error]);
  const pending = d?.items.some((i) => pendingStates.has(i.state));
  useEffect(() => {
    if (form || blocked || !pending || !d?.enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !requestNavigationLocked()) setAttempt((n) => n + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, [!!form, blocked, pending, d?.enabled]);
  // A published result is fetched by its new fixed version; don't relabel the old body as current.
  useEffect(() => {
    if (d && d.currentVersionId !== version && !form && !blocked) chooseVersion(d.currentVersionId);
  }, [d, version, !!form, blocked, chooseVersion]);
  return (
    <section className="experience-adjustment" aria-label="通用经验调整">
      <h3>内容调整</h3>
      {data.error ? (
        <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !d ? (
        <Loading />
      ) : (
        <>
          <p className="muted">
            说明需要纠正的内容和依据。系统自动核验，通过后发布新版本，当前内容在处理期间保持可用。
          </p>
          {!form && d.canSubmit && (
            <Button
              variant="ghost"
              onClick={() => setForm({ versionId: version, expectedRevision: d.revision, content: '' })}
            >
              提出内容调整
            </Button>
          )}
          {!d.canSubmit && d.currentVersionId === version && (
            <p className="muted">当前经验已停用，或已有调整正在处理。</p>
          )}
          {form && (
            <form
              className="experience-adjustment-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submission.submit({ ...form, content: form.content.trim() }, async (body, requestId) => {
                  await api.adjust(entry, { ...body, requestId });
                  setForm(null);
                  setAttempt((n) => n + 1);
                });
              }}
            >
              <Field label="调整建议与依据">
                <textarea
                  aria-label="调整建议与依据"
                  rows={5}
                  required
                  maxLength={12000}
                  disabled={blocked}
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="说明需要调整的方法、适用条件或限制，以及判断依据"
                />
              </Field>
              <p className="muted">建议只用于自动核验，不直接展示给企业；通过后的通用版本可供各企业参考。</p>
              {!d.enabled && <p role="status">自动处理尚未启用，提交后将等待核验。</p>}
              {(d.currentVersionId !== version || d.revision !== form.expectedRevision) && (
                <p role="status">经验状态或版本已变化，请取消后重新查看当前版本。</p>
              )}
              <SubmitError error={submission.error} uncertain={submission.uncertain} />
              <Button
                type="submit"
                disabled={
                  submission.busy ||
                  (!submission.uncertain &&
                    (!form.content.trim() || !d.canSubmit || d.revision !== form.expectedRevision))
                }
              >
                {submission.busy ? '正在提交…' : submission.uncertain ? '重试原请求' : '提交自动核验'}
              </Button>
              <Button variant="ghost" disabled={blocked} onClick={() => setForm(null)}>
                取消调整
              </Button>
            </form>
          )}
          {!!d.items.length && (
            <details open>
              <summary>我的近期调整</summary>
              {d.items.map((item) => (
                <div className="experience-adjustment-status" key={item.id}>
                  <Badge>{generalAdjustmentLabels[item.state]}</Badge>
                  <p className="muted">
                    {new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}
                  </p>
                  {pendingStates.has(item.state) && !d.enabled && <p>已保存，等待自动处理启用。</p>}
                  {['SKIPPED', 'REJECTED', 'FAILED', 'UNKNOWN', 'UNAVAILABLE', 'CONFLICT'].includes(
                    item.state,
                  ) && <p>这次调整未发布新版本。</p>}
                </div>
              ))}
            </details>
          )}
          <Button variant="ghost" disabled={blocked || !!form} onClick={() => setAttempt((n) => n + 1)}>
            刷新调整状态
          </Button>
        </>
      )}
    </section>
  );
}
