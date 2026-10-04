import { useContext, useState } from 'react';
import { companyClient, companyFields, type CompanyGroup, type CompanySuggestion } from './company-client';
import { Failure, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { Button, Modal } from '../shared/ui';
import { RequestPending, useRequestLock } from '../shared/request-guard';

export function CompanySuggestions({
  tenant,
  groups,
  changed,
}: {
  tenant: string;
  groups: CompanyGroup[];
  changed: () => void;
}) {
  const pending = useContext(RequestPending);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<CompanySuggestion>();
  const data = useRemote((signal) => companyClient.suggestions(tenant, signal), [tenant, attempt]);
  if (data.error) return <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />;
  if (!data.value?.length) return null;
  return (
    <section className="company-suggestions">
      <h3>更新建议</h3>
      <p className="muted">以下建议保留当前信息，采用后才会更新。未处理不影响工作。</p>
      {data.value.map((s) => (
        <Button key={s.id} disabled={pending} variant="ghost" onClick={() => setSelected(s)}>
          {companyFields[s.field]} · {s.label}
        </Button>
      ))}
      {selected && data.value.some((s) => s.id === selected.id && s.revision === selected.revision) && (
        <SuggestionChoice
          key={selected.id}
          tenant={tenant}
          suggestion={selected}
          group={groups.find((g) => g.field === selected.field)!}
          close={() => setSelected(undefined)}
          changed={changed}
        />
      )}
    </section>
  );
}
function SuggestionChoice({
  tenant,
  suggestion: s,
  group,
  close,
  changed,
}: {
  tenant: string;
  suggestion: CompanySuggestion;
  group: CompanyGroup;
  close: () => void;
  changed: () => void;
}) {
  const submit = useSubmission<{ action: 'ADOPT' | 'KEEP' }>();
  const locked = submit.busy || submit.uncertain;
  useRequestLock(locked);
  const current = group.tags.find((t) => t.id === s.targetId);
  const choose = (action: 'ADOPT' | 'KEEP') =>
    void submit.submit({ action }, async (body, requestId) => {
      await companyClient.decide(tenant, s.id, {
        ...body,
        requestId,
        expectedRevision: s.revision,
        expectedGroupRevision: group.revision,
      });
      changed();
    });
  return (
    <Modal
      title={`${companyFields[s.field]} · 更新建议`}
      onClose={() => {
        if (!locked) close();
      }}
    >
      <div className="company-comparison">
        <section>
          <h3>当前内容</h3>
          <p>{current?.label || (group.manuallyCleared ? '已由人工清空' : '当前无对应标签')}</p>
          {current?.meaning && <p>{current.meaning}</p>}
        </section>
        <section>
          <h3>建议内容</h3>
          <p>{s.label}</p>
          {s.meaning && <p>{s.meaning}</p>}
        </section>
      </div>
      <details className="company-evidence">
        <summary>查看依据</summary>
        {s.evidence.map((e) => (
          <article key={e.chunkId}>
            <strong>{e.filename}</strong>
            <p className="muted">{e.locator}</p>
            <blockquote>{e.quote}</blockquote>
          </article>
        ))}
      </details>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      <div className="company-editor-actions">
        <Button disabled={locked} onClick={close}>
          关闭
        </Button>
        {submit.uncertain ? (
          <Button variant="primary" disabled={submit.busy} onClick={() => choose('ADOPT')}>
            重试同一次操作
          </Button>
        ) : (
          <>
            <Button disabled={locked} onClick={() => choose('KEEP')}>
              保留当前
            </Button>
            <Button variant="primary" disabled={locked} onClick={() => choose('ADOPT')}>
              采用建议
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
