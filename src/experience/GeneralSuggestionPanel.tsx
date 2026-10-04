import { Select } from '../shared/Select';
import { useEffect, useState } from 'react';
import type { GeneralExperienceSuggestionChange } from '../../contracts/public-api/general-experience';
import { IdentityError } from '../identity/client';
import { Badge, Button, Field } from '../shared/ui';
import { Failure, Loading, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { requestNavigationLocked, useRequestLock } from '../shared/request-guard';
import { generalExperienceClient as api, generalProcessingLabels } from './general-client';
const pendingStates = new Set(['WAITING', 'PROCESSING', 'RETRYING']);
export type LocalExperienceSelection = { id: string; version: string; space: string };
export function GeneralSuggestionPanel({
  tenant,
  entry,
  version,
  locked,
  denied,
  chooseLocal,
}: {
  tenant: string;
  entry: string;
  version: string;
  locked: (value: boolean) => void;
  denied: (error: unknown) => void;
  chooseLocal?: (selection: LocalExperienceSelection) => void;
}) {
  type Form = Omit<GeneralExperienceSuggestionChange, 'requestId'>;
  const [attempt, setAttempt] = useState(0),
    [form, setForm] = useState<Form | null>(null);
  const submission = useSubmission<Form>();
  const blocked = submission.busy || submission.uncertain;
  useRequestLock(blocked);
  useEffect(() => {
    locked(blocked);
    return () => locked(false);
  }, [blocked, locked]);
  const data = useRemote(
    (signal) => api.suggestions(tenant, entry, version, signal),
    [tenant, entry, version, attempt],
  );
  const d = data.value;
  useEffect(() => {
    const e = data.error || submission.error;
    if (e instanceof IdentityError && [401, 403, 404].includes(e.status)) denied(e);
  }, [data.error, submission.error, denied]);
  const pending = d?.items.some((i) => pendingStates.has(i.state));
  useEffect(() => {
    if (form || blocked || !pending || !d?.enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !requestNavigationLocked()) setAttempt((n) => n + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, [!!form, blocked, pending, d?.enabled]);
  // Focus revalidation removes a form after its destination grant or future-use state changes.
  useEffect(() => {
    if (
      d &&
      form &&
      !blocked &&
      (!d.canSubmit || (form.workspaceId && !d.scopes.some((s) => s.id === form.workspaceId)))
    )
      setForm(null);
  }, [d, form, blocked]);
  const destinationPending =
    form && d?.items.some((i) => i.workspaceId === form.workspaceId && pendingStates.has(i.state));
  return (
    <section className="experience-adjustment" aria-label="企业补充与反馈">
      <h3>企业补充与反馈</h3>
      {data.error ? (
        <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !d ? (
        <Loading />
      ) : (
        <>
          <p className="muted">
            补充本企业适用条件，或反馈方法中的问题。系统自动核验，合格内容形成所选空间的企业经验。
          </p>
          {!d.canSubmit && <p className="muted">需要可维护的共享空间，且本企业未停用此经验。</p>}
          {!form && d.canSubmit && (
            <Button
              variant="ghost"
              onClick={() =>
                setForm({ versionId: version, workspaceId: '', intent: 'ADAPTATION', content: '' })
              }
            >
              补充或反馈
            </Button>
          )}
          {form && (
            <form
              className="experience-adjustment-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submission.submit({ ...form, content: form.content.trim() }, async (body, requestId) => {
                  await api.suggest(tenant, entry, { ...body, requestId });
                  setForm(null);
                  setAttempt((n) => n + 1);
                });
              }}
            >
              <Field label="目标空间">
                <Select
                  aria-label="目标空间"
                  required
                  disabled={blocked}
                  value={form.workspaceId}
                  onChange={(e) => setForm({ ...form, workspaceId: e.target.value })}
                >
                  <option value="">请选择共享空间</option>
                  {d.scopes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="提交类型">
                <Select
                  aria-label="提交类型"
                  disabled={blocked}
                  value={form.intent}
                  onChange={(e) => setForm({ ...form, intent: e.target.value as Form['intent'] })}
                >
                  <option value="ADAPTATION">企业补充</option>
                  <option value="FEEDBACK">问题反馈</option>
                </Select>
              </Field>
              <Field label="内容与依据">
                <textarea
                  aria-label="内容与依据"
                  required
                  maxLength={12000}
                  rows={5}
                  disabled={blocked}
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="说明适用条件、需要补充或纠正的内容，以及判断依据"
                />
              </Field>
              <p className="muted">
                提交内容仅用于自动处理；通过核验的企业经验将向该空间获权成员开放。总库版本保持不变。
              </p>
              {!d.enabled && <p role="status">自动积累尚未启用，提交后将等待处理。</p>}
              {destinationPending && <p role="status">这个空间已有补充或反馈正在处理。</p>}
              <SubmitError error={submission.error} uncertain={submission.uncertain} />
              <Button
                type="submit"
                disabled={
                  submission.busy ||
                  (!submission.uncertain &&
                    (!form.workspaceId || !form.content.trim() || !!destinationPending))
                }
              >
                {submission.busy ? '正在提交…' : submission.uncertain ? '重试原请求' : '提交自动处理'}
              </Button>
              <Button variant="ghost" disabled={blocked} onClick={() => setForm(null)}>
                取消补充
              </Button>
            </form>
          )}
          {!!d.items.length && (
            <details open>
              <summary>我的近期提交</summary>
              {d.items.map((item) => (
                <div key={item.id} className="experience-adjustment-status">
                  <span>
                    {item.intent === 'ADAPTATION' ? '企业补充' : '问题反馈'} ·{' '}
                    {d.scopes.find((s) => s.id === item.workspaceId)?.name || '原空间'}
                  </span>{' '}
                  <Badge>{generalProcessingLabels[item.state]}</Badge>
                  <p className="muted">
                    {new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}
                  </p>
                  {pendingStates.has(item.state) && (
                    <p>{d.enabled ? '系统正在自动处理。' : '已保存，等待自动积累启用。'}</p>
                  )}
                  {item.state === 'NOT_ADMITTED' && <p>未形成可用经验。可在积累与改进中查看处理原因。</p>}
                  {item.resultEntryId && item.resultVersionId && chooseLocal && (
                    <Button
                      variant="ghost"
                      disabled={blocked || !!form}
                      onClick={() =>
                        chooseLocal({
                          id: item.resultEntryId!,
                          version: item.resultVersionId!,
                          space: item.workspaceId,
                        })
                      }
                    >
                      查看企业经验
                    </Button>
                  )}
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
