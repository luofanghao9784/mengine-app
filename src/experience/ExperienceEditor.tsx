import { useExperienceGuard } from './useExperienceGuard';
import { useState } from 'react';
import type {
  ExperienceContent,
  ExperienceEntry,
  ExperienceEvidence,
} from '../../contracts/public-api/experience';
import { Button, Field } from '../shared/ui';
import { SubmitError, useSubmission } from '../shared/admin';
import { experienceClient as api } from './client';
import { ExperienceEvidencePicker } from './ExperienceEvidencePicker';
const blank: ExperienceContent = {
  kind: 'METHOD',
  title: '',
  summary: '',
  body: '',
  tags: [],
  applicable: '',
  excluded: '',
  dependencies: '',
  basis: '人工整理；尚未评测。',
  accessMode: 'INDEPENDENT_COPY',
};
export function ExperienceEditor({
  tenant,
  workspace,
  entry,
  seed,
  saved,
  cancel,
  onDenied,
}: {
  tenant: string;
  workspace: string;
  entry?: ExperienceEntry;
  seed?: ExperienceContent;
  saved: (e: ExperienceEntry) => void;
  cancel: () => void;
  onDenied: (e: unknown) => void;
}) {
  const [content, setContent] = useState<ExperienceContent>(entry?.version.content || seed || blank),
    [tags, setTags] = useState(content.tags.join('，')),
    [evidence, setEvidence] = useState<ExperienceEvidence[]>(entry?.version.evidence || []),
    [picker, setPicker] = useState(false);
  const submit = useSubmission<{
    content: ExperienceContent;
    evidence: ExperienceEvidence[];
    expectedRevision?: number;
  }>();
  useExperienceGuard(submit.busy || submit.uncertain);
  const disabled = submit.busy || submit.uncertain;
  const field = (key: keyof ExperienceContent, value: string) => setContent({ ...content, [key]: value });
  return (
    <form
      className="experience-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void submit.submit(
          {
            content: {
              ...content,
              tags: tags
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter(Boolean),
            },
            evidence,
            expectedRevision: entry?.revision,
          },
          async (b, key) => {
            try {
              saved(
                entry
                  ? await api.revise(tenant, workspace, entry.id, {
                      requestId: key,
                      expectedRevision: b.expectedRevision!,
                      content: b.content,
                      evidence: b.evidence,
                    })
                  : await api.create(tenant, workspace, {
                      requestId: key,
                      content: b.content,
                      evidence: b.evidence,
                    }),
              );
            } catch (error) {
              onDenied(error);
              throw error;
            }
          },
        );
      }}
    >
      <h3>{entry ? `从 v${entry.version.number} 整理新候选` : '手工整理经验候选'}</h3>
      <p className="experience-note">
        只填写有权在目标范围整理的内容，不粘贴整段私人会话、敏感原值或凭据。保存候选不会自动发布，也不会被记为已评测成功。
      </p>
      <div className="experience-form-grid">
        <Field label="经验类型">
          <select
            aria-label="经验类型"
            disabled={disabled}
            value={content.kind}
            onChange={(e) => field('kind', e.target.value)}
          >
            <option value="METHOD">方法参考</option>
            <option value="CASE">任务案例</option>
            <option value="CORRECTION">失败与纠正</option>
            <option value="ASSET">受控资产参考</option>
          </select>
        </Field>
        <Field label="来源与共享方式">
          <select
            aria-label="来源与共享方式"
            disabled={disabled}
            value={content.accessMode}
            onChange={(e) => field('accessMode', e.target.value)}
          >
            <option value="INDEPENDENT_COPY">独立人工整理副本</option>
            <option value="SOURCE_BOUND">持续依赖来源权限</option>
          </select>
        </Field>
      </div>
      <p className="experience-note">
        {content.accessMode === 'INDEPENDENT_COPY'
          ? '发布后，仅你填写的经验正文按目标空间权限读取；来源原文仍单独受限。发布前需明确确认。'
          : '读者还需能读取每项来源；来源回收或撤权时，此经验不再可读或可检索。至少关联一项证据。'}
      </p>
      <Field label="标题">
        <input
          aria-label="标题"
          required
          maxLength={160}
          disabled={disabled}
          value={content.title}
          onChange={(e) => field('title', e.target.value)}
        />
      </Field>
      <Field label="摘要">
        <textarea
          aria-label="摘要"
          required
          maxLength={600}
          rows={2}
          disabled={disabled}
          value={content.summary}
          onChange={(e) => field('summary', e.target.value)}
        />
      </Field>
      <Field label="可复用方法与检查步骤">
        <textarea
          aria-label="可复用方法与检查步骤"
          required
          maxLength={16000}
          rows={8}
          disabled={disabled}
          value={content.body}
          onChange={(e) => field('body', e.target.value)}
        />
      </Field>
      <div className="experience-form-grid">
        <Field label="适用条件">
          <textarea
            aria-label="适用条件"
            required
            maxLength={2000}
            rows={3}
            disabled={disabled}
            value={content.applicable}
            onChange={(e) => field('applicable', e.target.value)}
          />
        </Field>
        <Field label="不适用与反例">
          <textarea
            aria-label="不适用与反例"
            maxLength={2000}
            rows={3}
            disabled={disabled}
            value={content.excluded}
            onChange={(e) => field('excluded', e.target.value)}
          />
        </Field>
      </div>
      <Field label="资料、工具与版本依赖">
        <textarea
          aria-label="资料、工具与版本依赖"
          maxLength={2000}
          rows={2}
          disabled={disabled}
          value={content.dependencies}
          onChange={(e) => field('dependencies', e.target.value)}
        />
      </Field>
      <Field label="依据、实际核对范围与未知事项">
        <textarea
          aria-label="依据、实际核对范围与未知事项"
          required
          maxLength={2000}
          rows={3}
          disabled={disabled}
          value={content.basis}
          onChange={(e) => field('basis', e.target.value)}
        />
      </Field>
      <Field label="标签" hint="以逗号分隔，最多 20 项；标签不会改变权限。">
        <input disabled={disabled} value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
      <Button disabled={disabled} onClick={() => setPicker(!picker)}>
        {picker ? '收起证据选择' : `选择证据（${evidence.length}）`}
      </Button>
      {picker && (
        <ExperienceEvidencePicker
          tenant={tenant}
          workspace={workspace}
          evidence={evidence}
          onChange={setEvidence}
          disabled={disabled}
          onDenied={onDenied}
        />
      )}
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      <div className="experience-actions">
        <Button
          type="submit"
          variant="primary"
          disabled={submit.busy || (content.accessMode === 'SOURCE_BOUND' && !evidence.length)}
        >
          {submit.busy ? '正在保存…' : submit.uncertain ? '重试同次保存' : '保存候选'}
        </Button>
        <Button disabled={submit.busy || submit.uncertain} onClick={cancel}>
          返回
        </Button>
      </div>
    </form>
  );
}
