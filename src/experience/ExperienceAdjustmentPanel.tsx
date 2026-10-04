import { useEffect, useRef, useState } from 'react';
import type { ExperienceEntry, ExperienceProposal } from '../../contracts/public-api/experience';
import { Badge, Button, Field } from '../shared/ui';
import { Failure, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { requestNavigationLocked, useRequestLock } from '../shared/request-guard';
import { experienceAdjustmentClient as api } from './adjustment-client';
import { processingLabels } from './management-client';
import { IdentityError } from '../identity/client';
const pendingStates = new Set(['WAITING', 'PROCESSING', 'RETRYING']);
export function ExperienceAdjustmentPanel({
  tenant,
  space,
  entry,
  editing,
  locked,
  chooseVersion,
  changed,
}: {
  tenant: string;
  space: string;
  entry: ExperienceEntry;
  editing: (v: boolean) => void;
  locked: (v: boolean) => void;
  chooseVersion: (v: string) => void;
  changed: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<{
    proposal: ExperienceProposal;
    versionId: string;
    expectedRevision: number;
  } | null>(null);
  const [tags, setTags] = useState('');
  const submission = useSubmission<{
    proposal: ExperienceProposal;
    versionId: string;
    expectedRevision: number;
  }>();
  const blocked = submission.busy || submission.uncertain;
  useRequestLock(blocked);
  useEffect(() => {
    locked(blocked);
    return () => locked(false);
  }, [blocked, locked]);
  useEffect(() => {
    editing(!!form);
    return () => editing(false);
  }, [!!form, editing]);
  const data = useRemote(
    (signal) => api.list(tenant, space, entry.id, signal),
    [tenant, space, entry.id, entry.revision, attempt],
  );
  const latest = data.value?.items[0],
    pending = latest && pendingStates.has(latest.state);
  const changedRef = useRef(changed);
  changedRef.current = changed;
  useEffect(() => {
    const error = submission.error;
    if (error instanceof IdentityError && [403, 404].includes(error.status)) {
      setForm(null);
      setAttempt((n) => n + 1);
      changedRef.current();
    }
  }, [submission.error]);
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    const signature = latest ? `${latest.id}:${latest.state}:${latest.resultVersionId}` : '';
    const previous = seen.current;
    seen.current = signature;
    if (previous && previous !== signature && latest?.resultVersionId && !form) changedRef.current();
  }, [latest?.id, latest?.state, latest?.resultVersionId, !!form]);
  useEffect(() => {
    if (form || blocked || !pending || !data.value?.enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !requestNavigationLocked()) setAttempt((n) => n + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, [!!form, blocked, pending, data.value?.enabled]);
  const current = entry.status === 'PUBLISHED' && entry.publishedVersion === entry.version.id;
  const begin = () => {
    const c = entry.version.content;
    setTags(c.tags.join('，'));
    setForm({
      versionId: entry.version.id,
      expectedRevision: entry.revision,
      proposal: {
        title: c.title,
        summary: c.summary,
        body: c.body,
        tags: c.tags,
        applicable: c.applicable,
        excluded: c.excluded,
        reason: '',
      },
    });
  };
  return (
    <section className="experience-adjustment" aria-label="经验内容调整">
      {data.error ? (
        <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
      ) : (
        <>
          {!form && current && (
            <Button variant="ghost" disabled={!data.value || !!pending} onClick={begin}>
              调整内容
            </Button>
          )}
          {latest && (
            <div className="experience-adjustment-status" role="status">
              <span>最近一次调整</span> <Badge>{processingLabels[latest.state]}</Badge>
              {pending && (
                <p>
                  {data.value?.enabled
                    ? '系统正在自动处理，原版本继续可用。'
                    : '自动积累尚未启用，调整已保存并等待处理。'}
                </p>
              )}
              {latest.state === 'NOT_ADMITTED' && (
                <p>这次调整未形成可用新版本，原版本保持不变。可在积累与改进中查看处理原因。</p>
              )}
              {['FAILED', 'UNKNOWN', 'UNAVAILABLE'].includes(latest.state) && (
                <p>这次调整未生效，请核对处理状态与当前来源。</p>
              )}
              {latest.resultVersionId && latest.resultVersionId !== entry.version.id && (
                <Button
                  variant="ghost"
                  disabled={blocked || !!form}
                  onClick={() => chooseVersion(latest.resultVersionId!)}
                >
                  查看处理后的版本
                </Button>
              )}
            </div>
          )}
          {form && (
            <form
              className="experience-adjustment-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submission.submit(
                  {
                    ...form,
                    proposal: {
                      ...form.proposal,
                      tags: [
                        ...new Set(
                          tags
                            .split(/[,，]/)
                            .map((t) => t.trim())
                            .filter(Boolean),
                        ),
                      ],
                    },
                  },
                  async (body, requestId) => {
                    await api.submit(tenant, space, entry.id, { ...body, requestId });
                    setForm(null);
                    setAttempt((n) => n + 1);
                  },
                );
              }}
            >
              <p>系统会根据原经验和调整依据自动核验、提炼新版本，提交不会直接替换当前内容。</p>
              {(
                [
                  ['title', '标题', 160, 1],
                  ['summary', '摘要', 600, 2],
                  ['body', '方法', 16000, 5],
                  ['applicable', '适用条件', 2000, 2],
                  ['excluded', '不适用与限制', 2000, 2],
                  ['reason', '调整原因与依据', 2000, 3],
                ] as const
              ).map(([key, label, max, rows]) => (
                <Field key={key} label={label}>
                  <textarea
                    aria-label={label}
                    required={key !== 'excluded'}
                    maxLength={max}
                    rows={rows}
                    disabled={blocked}
                    value={form.proposal[key]}
                    onChange={(e) =>
                      setForm({ ...form, proposal: { ...form.proposal, [key]: e.target.value } })
                    }
                  />
                </Field>
              ))}
              <Field label="标签">
                <input
                  aria-label="经验标签"
                  value={tags}
                  maxLength={820}
                  disabled={blocked}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="用逗号分隔"
                />
              </Field>
              <SubmitError error={submission.error} uncertain={submission.uncertain} />
              <Button type="submit" disabled={submission.busy}>
                {submission.busy ? '正在提交…' : submission.uncertain ? '重试原调整' : '提交调整'}
              </Button>
              <Button variant="ghost" disabled={blocked} onClick={() => setForm(null)}>
                取消调整
              </Button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
