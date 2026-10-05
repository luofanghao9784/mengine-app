import { MagazineBody } from './Magazine';
import { MagazineGrid } from './MagazineGrid';
import { DataBriefing } from './DataBriefing';
import { readBriefing } from './content';
import { useEffect, useRef, useState } from 'react';
import { DocumentText, Button } from '../shared/ui';
import { Failure, Loading, useRemote } from '../shared/admin';
import { conversationClient } from '../conversation/client';
import { conversationHref } from '../conversation/Conversations';
import { readableTask } from './reading-state';
import type { CardPresentation } from './card-presentation';

export type ReadingTask = {
  conversationId: string;
  taskId: string;
  taskRevision: number;
  attempt: number;
  workspaceId: string;
  presentation?: CardPresentation;
};
export type ReadingHeader = { title: string; date: string; contentLabel?: string };
export function TaskReadingBody({
  tenant,
  task,
  onRead,
  onSource,
  onHeader,
  preview,
}: {
  tenant: string;
  task: ReadingTask;
  onRead?: () => void;
  onSource?: (id: string, title: string) => void;
  onHeader?: (header: ReadingHeader | undefined) => void;
  preview?: { workspace: string; open: () => void };
}) {
  const [attempt, setAttempt] = useState(0);
  const data = useRemote(
    (signal) => conversationClient.taskDetail(tenant, task.conversationId, task.taskId, signal),
    [tenant, task.conversationId, task.taskId, task.taskRevision, task.attempt, attempt],
  );
  const result = data.value?.tasks[0];
  const hasBriefing = !!result?.artifacts.some(
    (a) =>
      a.filename.startsWith('briefing-data-') ||
      a.filename.startsWith('briefing-text-') ||
      a.filename.startsWith('briefing-dataset-'),
  );
  const generated = useRemote(
    (signal) =>
      hasBriefing
        ? readBriefing(tenant, task.conversationId, task.taskId, task.taskRevision, task.attempt, signal)
        : Promise.resolve(null),
    [tenant, task.conversationId, task.taskId, task.taskRevision, task.attempt, hasBriefing, attempt],
  );
  const state = readableTask(data.value, task);
  const headerReady =
    state === 'ready' && !data.error && !generated.error && (!hasBriefing || !!generated.value);
  const title = headerReady ? (generated.value?.content.title ?? data.value?.conversation.title) : undefined;
  const date = headerReady ? (generated.value?.content.generatedAt ?? result?.createdAt) : undefined;
  const contentLabel = generated.value?.content.schemaVersion === 'briefing-data-v1' ? '数据分析' : undefined;
  useEffect(() => {
    onHeader?.(title && date ? { title, date, contentLabel } : undefined);
  }, [onHeader, title, date, contentLabel]);
  const notified = useRef(false),
    read = useRef(onRead);
  read.current = onRead;
  useEffect(() => {
    if (state === 'ready' && !notified.current) {
      notified.current = true;
      read.current?.();
    }
  }, [state]);
  if (data.error) return <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />;
  if (!data.value) return <Loading />;
  if (state !== 'ready' || !result)
    return (
      <div className="live-reading-unavailable" role="status">
        <p>
          {state === 'restricted'
            ? '这份成果的资料权限已变化，当前不能显示原文。'
            : '这份成果已更新，当前卡片对应的版本暂时无法读取。请刷新画报后重新打开。'}
        </p>
        <Button onClick={() => setAttempt((n) => n + 1)}>重新核对</Button>
      </div>
    );
  if (preview) {
    if (generated.error) return <Failure error={generated.error} retry={() => setAttempt((n) => n + 1)} />;
    if (hasBriefing && !generated.value) return <Loading />;
    const document = generated.value;
    return (
      <div className="conversation-briefing-cover">
        <MagazineGrid
          sizing="workspace"
          presentation={task.presentation}
          interactive={false}
          items={[
            {
              id: task.taskId,
              title: document?.content.title ?? data.value.conversation.title,
              summary: document?.content.summary ?? (result.reply || '').slice(0, 240),
              chart: !!document?.content.chart,
              fixedSize: task.presentation?.size ?? (document?.content.chart ? '2×2' : undefined),
              render: (
                <article className="live-briefing-card conversation-briefing-preview">
                  <button
                    type="button"
                    className="live-briefing-body"
                    onClick={preview.open}
                    aria-label={`查看画报：${document?.content.title ?? data.value.conversation.title}`}
                  >
                    <MagazineBody
                      briefing={document}
                      title={document?.content.title ?? data.value.conversation.title}
                      excerpt={document?.content.summary ?? (result.reply || '').slice(0, 240)}
                      truncated={!document && (result.reply?.length ?? 0) > 240}
                      workspace={preview.workspace}
                      date={document?.content.generatedAt ?? result.createdAt}
                      footer={
                        result.artifacts.length > 0 ? (
                          <span>{result.artifacts.length} 份成果</span>
                        ) : undefined
                      }
                      verification={result.executionClass === 'verification'}
                    />
                  </button>
                </article>
              ),
            },
          ]}
        />
      </div>
    );
  }
  return (
    <>
      {result.executionClass === 'verification' && (
        <p className="live-verification-label">联调验证内容 · 未调用真实模型</p>
      )}
      {hasBriefing ? (
        generated.error ? (
          <Failure error={generated.error} retry={() => setAttempt((n) => n + 1)} />
        ) : generated.value ? (
          <DataBriefing document={generated.value} />
        ) : (
          <Loading />
        )
      ) : (
        <DocumentText text={result.reply || ''} />
      )}
      {(result.sources.length > 0 ||
        result.webSources.length > 0 ||
        result.originals.length > 0 ||
        result.artifacts.length > 0) && (
        <details className="live-reading-sources">
          <summary>
            资料来源与附件（
            {result.sources.length +
              result.webSources.length +
              result.originals.length +
              result.artifacts.length}
            ）
          </summary>
          {result.sources.map((s) => (
            <p key={s.id}>
              {onSource ? (
                <Button variant="ghost" onClick={() => onSource(s.id, s.filename + ' · v' + s.version)}>
                  {s.filename} · v{s.version} · {s.locator}
                </Button>
              ) : (
                <>
                  {s.filename} · v{s.version} · {s.locator}
                </>
              )}
            </p>
          ))}
          {result.webSources.map((s) => (
            <p key={s.id}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title}
              </a>
              <span className="muted">
                {' '}
                ·{' '}
                {s.publishedAt
                  ? `发布于 ${new Date(s.publishedAt).toLocaleDateString('zh-CN')}`
                  : '发布日期未核实'}{' '}
                · 检索于 {new Date(s.retrievedAt).toLocaleDateString('zh-CN')}
              </span>
            </p>
          ))}
          {result.originals.map((s) => (
            <p key={s.versionId}>
              {s.filename} · v{s.version}
              {s.read ? ' · 已读取' : ''}
            </p>
          ))}
          {result.artifacts.map((s) => (
            <p key={s.id}>{s.filename}</p>
          ))}
          <a
            href={conversationHref(tenant, task.conversationId) + '&task=' + encodeURIComponent(task.taskId)}
          >
            在原会话查看引用和下载附件
          </a>
        </details>
      )}
    </>
  );
}
