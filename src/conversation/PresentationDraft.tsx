import { useState } from 'react';
import { Button } from '../components/ui';
import { Failure, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';
import { presentationClient } from './presentation-client';
import type {
  PresentationConfirmation,
  PresentationDraft as Draft,
} from '../../contracts/public-api/presentation';
import './presentation.css';

export function PresentationDraft({
  tenant,
  conversation,
  task,
  revision,
  changed,
}: {
  tenant: string;
  conversation: string;
  task: string;
  revision: number;
  changed: () => void;
}) {
  const [reload, setReload] = useState(0);
  const remote = useRemote(
    (signal) => presentationClient.read(tenant, conversation, task, signal),
    [tenant, conversation, task, revision, reload],
  );
  if (remote.error) return <Failure error={remote.error} retry={() => setReload((n) => n + 1)} />;
  if (!remote.value || remote.value.state !== 'DRAFT' || !remote.value.spec) return null;
  return (
    <DraftEditor
      key={`${task}:${remote.value.revision}`}
      draft={remote.value}
      revision={revision}
      send={async (body, id) => {
        await presentationClient.confirm(tenant, conversation, task, body, id);
        changed();
      }}
    />
  );
}
function DraftEditor({
  draft,
  revision,
  send,
}: {
  draft: Draft;
  revision: number;
  send: (body: PresentationConfirmation, id: string) => Promise<void>;
}) {
  const spec = draft.spec!;
  const [title, setTitle] = useState(spec.title),
    [theme, setTheme] = useState(spec.theme);
  const [slides, setSlides] = useState(spec.slides.map((slide, index) => ({ ...slide, index })));
  const submit = useSubmission<PresentationConfirmation>();
  useRequestLock(submit.busy || submit.uncertain);
  function move(index: number, direction: number) {
    setSlides((old) => {
      const next = [...old];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  }
  return (
    <section className="presentation-draft" aria-label="PPT 大纲确认">
      <h3>PPT 大纲 · {slides.length} 页</h3>
      <p>检查内容后可修改标题、调整页序。确认后生成可编辑的 PPT。</p>
      <fieldset disabled={submit.busy || submit.uncertain}>
        <label>
          演示标题
          <input
            aria-label="演示标题"
            maxLength={48}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          演示风格
          <select
            aria-label="演示风格"
            value={theme}
            onChange={(e) => setTheme(e.target.value as typeof theme)}
          >
            <option value="ocean">海蓝商务</option>
            <option value="ink">墨色简约</option>
          </select>
        </label>
        <ol>
          {slides.map((slide, i) => (
            <li key={slide.index}>
              <div className="presentation-slide-heading">
                <span>第 {i + 1} 页</span>
                <input
                  aria-label={`第 ${i + 1} 页标题`}
                  maxLength={40}
                  value={slide.title}
                  onChange={(e) =>
                    setSlides((old) => old.map((s, n) => (n === i ? { ...s, title: e.target.value } : s)))
                  }
                />
                <Button
                  variant="ghost"
                  aria-label={`上移第 ${i + 1} 页`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`下移第 ${i + 1} 页`}
                  disabled={i === slides.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
              </div>
              {slide.subtitle && <p>{slide.subtitle}</p>}
              {slide.bullets && (
                <ul>
                  {slide.bullets.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              )}
              {slide.headers && (
                <div className="presentation-table">
                  <table>
                    <thead>
                      <tr>
                        {slide.headers.map((h, j) => (
                          <th key={j}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {slide.rows?.map((r, j) => (
                        <tr key={j}>
                          {r.map((c, k) => (
                            <td key={k}>{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {slide.labels && (
                <p>
                  {slide.series}：
                  {slide.labels.map((l, j) => `${l} ${slide.values?.[j]}${slide.unit || ''}`).join('；')}
                </p>
              )}
              <small>
                {slide.sourceIds.length
                  ? `引用 ${slide.sourceIds.length} 处资料，见会话来源`
                  : '未引用空间资料，请核对内容依据'}
              </small>
            </li>
          ))}
        </ol>
      </fieldset>
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
      <Button
        disabled={submit.busy || !title.trim() || slides.some((s) => !s.title.trim())}
        onClick={() =>
          void submit.submit(
            {
              expectedRevision: revision,
              draftRevision: draft.revision!,
              title,
              theme,
              slides: slides.map((s) => ({ index: s.index, title: s.title })),
            },
            send,
          )
        }
      >
        {submit.busy ? '正在提交…' : submit.uncertain ? '重试本次确认' : '确认大纲并生成 PPT'}
      </Button>
    </section>
  );
}
