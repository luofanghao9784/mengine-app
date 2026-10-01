import { useEffect, useState } from 'react';
import type { ExperienceEvidence } from '../../contracts/public-api/experience';
import { identityClient } from '../identity/session';
import { conversationClient } from '../conversation/client';
import { SourceVersionPicker, type SourceVersion } from '../source/SourceVersionPicker';
import { Button, Field } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import '../source/source.css';
export function ExperienceEvidencePicker({
  tenant,
  workspace,
  evidence,
  onChange,
  disabled,
  onDenied,
}: {
  tenant: string;
  workspace: string;
  evidence: ExperienceEvidence[];
  onChange: (v: ExperienceEvidence[]) => void;
  disabled: boolean;
  onDenied: (e: unknown) => void;
}) {
  const [sourceSpace, setSourceSpace] = useState(workspace),
    [mode, setMode] = useState<'material' | 'task'>('material'),
    [selected, setSelected] = useState<SourceVersion[]>([]),
    [conversation, setConversation] = useState<string>(),
    [page, setPage] = useState(0),
    [taskPage, setTaskPage] = useState(0);
  const spaces = useRemote((signal) => identityClient.context(tenant, signal), [tenant]);
  const conversations = useRemote(
    (signal) =>
      mode === 'task' ? conversationClient.list(tenant, page * 20, signal) : Promise.resolve(null),
    [tenant, mode, page],
  );
  const detail = useRemote(
    (signal) =>
      conversation
        ? conversationClient.detail(tenant, conversation, taskPage * 20, signal)
        : Promise.resolve(null),
    [tenant, conversation, taskPage],
  );
  useEffect(() => {
    const error = spaces.error || conversations.error || detail.error;
    if (error) onDenied(error);
  }, [spaces.error, conversations.error, detail.error, onDenied]);
  const add = (ref: ExperienceEvidence) => {
    if (!evidence.some((e) => e.kind === ref.kind && e.referenceId === ref.referenceId))
      onChange([...evidence, ref]);
  };
  return (
    <div className="experience-evidence">
      <h4>关联获准证据</h4>
      <p className="experience-note">
        只保存确切版本或任务的引用，不复制原文。任务的资料依赖会一并固定。最多选择 20 项。
      </p>
      {evidence.length > 0 && (
        <ul className="experience-refs">
          {evidence.map((e) => (
            <li key={e.kind + e.referenceId}>
              <span>
                {e.kind === 'TASK' ? '任务' : '资料版本'} · {e.referenceId}
              </span>
              <Button
                disabled={disabled}
                variant="ghost"
                onClick={() => {
                  setSelected((old) => old.filter((v) => v.versionId !== e.referenceId));
                  onChange(evidence.filter((x) => x !== e));
                }}
              >
                移除
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="experience-actions">
        <Button
          disabled={disabled}
          variant={mode === 'material' ? 'primary' : 'secondary'}
          onClick={() => setMode('material')}
        >
          资料版本
        </Button>
        <Button
          disabled={disabled}
          variant={mode === 'task' ? 'primary' : 'secondary'}
          onClick={() => setMode('task')}
        >
          我的已结束任务
        </Button>
      </div>
      {mode === 'material' ? (
        <>
          <Field label="来源空间">
            <select
              aria-label="来源空间"
              disabled={disabled || !spaces.value}
              value={sourceSpace}
              onChange={(e) => {
                setSourceSpace(e.target.value);
                setSelected([]);
              }}
            >
              {spaces.value?.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          {spaces.error ? (
            <Failure error={spaces.error} retry={() => onDenied(spaces.error)} />
          ) : spaces.value ? (
            <SourceVersionPicker
              key={sourceSpace}
              tenant={tenant}
              workspace={sourceSpace}
              selected={selected}
              disabled={disabled || evidence.length >= 20}
              onDenied={onDenied}
              onChange={(versions) => {
                setSelected(versions);
                const existing = evidence.filter(
                  (e) =>
                    !(e.kind === 'MATERIAL_VERSION' && selected.some((v) => v.versionId === e.referenceId)),
                );
                onChange(
                  [
                    ...existing,
                    ...versions.map((v) => ({
                      kind: 'MATERIAL_VERSION' as const,
                      referenceId: v.versionId,
                      workspaceId: sourceSpace,
                    })),
                  ].filter(
                    (e, i, a) =>
                      a.findIndex((x) => x.kind === e.kind && x.referenceId === e.referenceId) === i,
                  ),
                );
              }}
            />
          ) : (
            <Loading />
          )}
        </>
      ) : (
        <>
          {conversation ? (
            <>
              <Button onClick={() => setConversation(undefined)}>返回会话列表</Button>
              {detail.error ? (
                <Failure error={detail.error} retry={() => setConversation(undefined)} />
              ) : detail.value ? (
                <>
                  <ul className="experience-picker-list">
                    {detail.value.tasks
                      .filter((t) => ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(t.status))
                      .map((t) => (
                        <li key={t.id}>
                          <span>
                            {t.prompt}
                            <small>
                              {t.status} · {t.executionClass || '未记录执行类别'}
                            </small>
                          </span>
                          <Button
                            disabled={
                              disabled ||
                              evidence.length >= 20 ||
                              evidence.some((e) => e.referenceId === t.id)
                            }
                            onClick={() =>
                              add({
                                kind: 'TASK',
                                referenceId: t.id,
                                workspaceId: detail.value!.conversation.workspaceId,
                              })
                            }
                          >
                            关联任务
                          </Button>
                        </li>
                      ))}
                  </ul>
                  <p className="experience-note">
                    任务结束不等于已验证方法有效；合成任务不得标为真实业务成功。
                  </p>
                  <Pager page={taskPage} next={detail.value.hasMore} onPage={setTaskPage} />
                </>
              ) : (
                <Loading />
              )}
            </>
          ) : conversations.error ? (
            <Failure error={conversations.error} retry={() => setMode('material')} />
          ) : conversations.value ? (
            <>
              <ul className="experience-picker-list">
                {conversations.value.items.map((c) => (
                  <li key={c.id}>
                    <span>{c.title}</span>
                    <Button
                      onClick={() => {
                        setConversation(c.id);
                        setTaskPage(0);
                      }}
                    >
                      选择任务
                    </Button>
                  </li>
                ))}
              </ul>
              {!conversations.value.items.length && <p>还没有可关联的会话，可先不填证据引用。</p>}
              <Pager page={page} next={conversations.value.hasMore} onPage={setPage} />
            </>
          ) : (
            <Loading />
          )}
        </>
      )}
    </div>
  );
}
