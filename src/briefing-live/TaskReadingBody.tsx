import { isInternalBriefingArtifact } from './editorial-policy';
import { Disclosure } from '../components/Disclosure';
import { editorialEvidence } from './editorial-evidence';
import { BackgroundTaskEvidence } from '../profile/BackgroundTaskEvidence';
import { ReplyReferences } from '../conversation/ReplyReferences';
import { ReadingEvidence } from './ReadingEvidence';
import { MagazineBody } from './Magazine';
import { MagazineGrid } from './MagazineGrid';
import { DataBriefing, DataBriefingEvidence } from './DataBriefing';
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
      a.filename === 'briefing-chain.json' ||
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
  const artifacts = result.artifacts.filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index);
  const attachments = artifacts.filter((item) => !isInternalBriefingArtifact(item.filename));
  const executionNotes = (
    <>
      {result.executionClass === 'verification' &&
        !result.engineVersion?.startsWith('codex-demo-import-') && (
          <p className="live-verification-label">联调验证内容 · 未调用真实模型</p>
        )}
      {generated.value && editorialEvidence(generated.value).notes.map((note) => <p key={note}>{note}</p>)}
      {artifacts.filter((item) => isInternalBriefingArtifact(item.filename)).length > 0 && (
        <section className="reading-evidence">
          <h4>技术文件</h4>
          <ul>{artifacts.filter((item) => isInternalBriefingArtifact(item.filename)).map((item) => <li key={item.id}>{item.filename}</li>)}</ul>
          <a href={conversationHref(tenant, task.conversationId) + '&task=' + encodeURIComponent(task.taskId)}>在会话中查看与下载</a>
        </section>
      )}
    </>
  );
  return (
    <>
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
      <Disclosure className="reading-evidence-group" title="查看依据" description="资料来源、统计范围与计算口径">
        {generated.value && (
          <DataBriefingEvidence
            document={generated.value}
            sourceInReferences={result.sources.some(
              (source) =>
                source.materialId === generated.value?.content.source?.materialId &&
                source.versionId === generated.value?.content.source?.versionId,
            )}
          />
        )}
        <ReplyReferences
          flat
          sources={result.sources.filter(
            (source, index, all) => all.findIndex((other) => other.id === source.id) === index,
          )}
          scopeSource={generated.value?.content.source}
          citation={
            onSource
              ? (id) => {
                  const source = result.sources.find((s) => s.id === id)!;
                  onSource(id, source.filename + ' · v' + source.version);
                }
              : undefined
          }
        />
        {result.sources.length > 0 && !onSource && (
          <p className="reading-source-link">
            <a
              href={
                conversationHref(tenant, task.conversationId) + '&task=' + encodeURIComponent(task.taskId)
              }
            >
              在会话中查看来源
            </a>
          </p>
        )}
        {result.webSources.map((s) => (
          <ReadingEvidence key={s.id} title="网络来源" filename={s.title}>
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              查看原文
            </a>
            <p>
              {s.publishedAt
                ? `发布于 ${new Date(s.publishedAt).toLocaleDateString('zh-CN')}`
                : '发布日期未核实'}{' '}
              · 检索于 {new Date(s.retrievedAt).toLocaleDateString('zh-CN')}
            </p>
          </ReadingEvidence>
        ))}
        {result.originals
          .filter(
            (s, i, all) =>
              all.findIndex((other) => other.versionId === s.versionId) === i &&
              s.versionId !== generated.value?.content.source?.versionId &&
              !result.sources.some((source) => source.versionId === s.versionId),
          )
          .map((s) => (
            <ReadingEvidence key={s.versionId} title="原始资料" filename={s.filename} version={s.version}>
              <a
                href={
                  conversationHref(tenant, task.conversationId) + '&task=' + encodeURIComponent(task.taskId)
                }
              >
                在会话中查看原件
              </a>
            </ReadingEvidence>
          ))}
        {result.mode === 'AGENT' && result.status === 'SUCCEEDED' ? (
          <BackgroundTaskEvidence tenant={tenant} conversation={task.conversationId} task={task.taskId}>
            {executionNotes}
          </BackgroundTaskEvidence>
        ) : (
          <Disclosure title="详细执行记录" description="生成说明与技术记录">{executionNotes}</Disclosure>
        )}
      </Disclosure>
      {attachments.length > 0 && (
        <Disclosure className="reading-evidence-group" title="成果附件" description="查看或下载本次成果文件" count={attachments.length}>
          {attachments.map((s) => (
            <ReadingEvidence key={s.id} title="" filename={s.filename}>
              <a href={conversationHref(tenant, task.conversationId) + '&task=' + encodeURIComponent(task.taskId)}>
                在会话中查看与下载
              </a>
            </ReadingEvidence>
          ))}
        </Disclosure>
      )}
    </>
  );
}
