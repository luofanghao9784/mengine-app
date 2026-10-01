import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { GenerationBatch } from '../../contracts/public-api/briefing-generation';
import { useRemote, useSubmission, SubmitError } from '../shared/admin';
import { useViewState } from '../shared/useViewState';
import { Button } from '../shared/ui';
import { generationClient as api } from './generation-client';
import './generation.css';
const open = (b: GenerationBatch) =>
  ['QUEUED', 'RUNNING', 'WAITING_DATA', 'WAITING_RESOURCE', 'WAITING_CAPABILITY'].includes(b.status);
const label: Record<string, string> = {
  QUEUED: '已排队',
  RUNNING: '正在分析资料',
  WAITING_DATA: '等待资料就绪',
  WAITING_RESOURCE: '等待可用额度或执行资源',
  WAITING_CAPABILITY: '等待主模型可用',
  SUCCEEDED: '新画报已生成',
  NO_NEW_CONTENT: '暂无更多新内容',
  FAILED: '本次生成未完成',
  CANCELLED: '已取消本次生成',
  AUTHORITY_REVOKED: '资料权限已变化，本次生成已停止',
};
const reasons: Record<string, string> = {
  NEWS_SOURCE_UNAVAILABLE: '资讯来源尚未接入，接入后系统会结合企业与项目资料筛选相关资讯。',
  NEWS_CONTEXT_UNAVAILABLE: '请先在资料库准备企业或项目资料，供主模型判断资讯相关性。',
  RESULT_NOT_READY: '尚无已完成并保存到资料库的成果。',
  NO_MATERIALS: '先将资料加入资料库，系统会在资料就绪后自动继续。',
  MATERIALS_NOT_READY: '资料仍在解析，或需要处理解析问题。',
  MERGING_DATA_EVENTS: '正在等待本批资料完成更新。',
  DAILY_RUN_LIMIT: '今天的画报生成额度已用完，将在额度恢复后继续。',
  TASK_LIMIT: '主模型达到本次执行上限，可稍后重试。',
  NO_NEW_CONTENT: '现有资料暂未支持新的分析，不重复生成旧卡。',
};
export function GenerationPanel({
  tenant,
  workspace,
  businessType,
  onDelivered,
  onRefresh,
}: {
  tenant: string;
  workspace?: string;
  businessType?: string;
  onDelivered: (cards: string[]) => void;
  onRefresh: () => void;
}) {
  const [revision, setRevision] = useState(0),
    [actionError, setActionError] = useState<unknown>();
  const [requested, setRequested] = useViewState<string | undefined>(
    tenant,
    'briefing:generation-request',
    undefined,
    (v): v is string | undefined => v === undefined || typeof v === 'string',
  );
  const submission = useSubmission<{ workspaceId?: string; businessType?: string }>();
  const state = useRemote((signal) => api.state(tenant, signal), [tenant, revision]);
  const delivered = useRef(new Set<string>());
  const callback = useRef(onDelivered);
  callback.current = onDelivered;
  useEffect(() => {
    const timer = setInterval(() => setRevision((v) => v + 1), 5000);
    return () => clearInterval(timer);
  }, [tenant]);
  const batches = state.value?.batches.filter((b) => !workspace || b.workspaceId === workspace) || [];
  const active = batches.find((b) => open(b) && b.businessType === (businessType || null)),
    current = batches.find((b) => b.id === requested) || active || batches[0];
  useEffect(() => {
    const b = state.value?.batches.find((b) => b.id === requested);
    if (b && !open(b) && !delivered.current.has(b.id)) {
      delivered.current.add(b.id);
      if (b.cardIds.length) callback.current(b.cardIds);
    }
  }, [state.value, requested]);
  const [backgroundSeen, setBackgroundSeen] = useState<string[]>();
  const finished = batches.filter((b) => b.status === 'SUCCEEDED' && b.id !== requested).map((b) => b.id);
  useEffect(() => {
    if (state.value && backgroundSeen === undefined) setBackgroundSeen(finished);
  }, [state.value, backgroundSeen]);
  const newBackground = backgroundSeen !== undefined && finished.some((id) => !backgroundSeen.includes(id));
  return (
    <section className="briefing-generation" aria-label="生成新画报">
      {newBackground && (
        <Button
          onClick={() => {
            setBackgroundSeen(finished);
            onRefresh();
          }}
        >
          有新内容 · 查看
        </Button>
      )}
      <Button
        icon={Sparkles}
        disabled={submission.busy || !!active}
        onClick={() =>
          void submission.submit({ workspaceId: workspace, businessType }, async (body, requestId) => {
            const b = await api.generate(tenant, { ...body, requestId });
            setRequested(b.id);
            setRevision((v) => v + 1);
          })
        }
      >
        {submission.uncertain ? '重试本次请求' : active ? '正在准备新画报' : '生成更多'}
      </Button>
      {current && (
        <div role="status">
          <p>{label[current.status]}</p>
          {current.reason && reasons[current.reason] && <p className="muted">{reasons[current.reason]}</p>}
          {!!current.cardIds.length && (
            <Button variant="ghost" onClick={onRefresh}>
              查看新画报
            </Button>
          )}
          {open(current) && (
            <Button
              variant="ghost"
              onClick={() =>
                void api
                  .cancel(tenant, current.id)
                  .then(() => setRevision((v) => v + 1))
                  .catch(setActionError)
              }
            >
              取消本次
            </Button>
          )}
        </div>
      )}
      <SubmitError error={submission.error || actionError || state.error} uncertain={submission.uncertain} />
      <details>
        <summary>自动生成设置</summary>
        <p className="muted">
          系统在资料就绪或有新资料时生成画报。资讯定期结合企业、项目和资料库上下文，从已接入的公开来源中筛选。暂停只影响后续自动生成，个人计划保持独立。
        </p>
        {(state.value?.policies || [])
          .filter((p) => !workspace || p.workspaceId === workspace)
          .map((p) => (
            <div key={p.id}>
              <span>
                {p.workspaceName} · {p.enabled ? '自动生成已开启' : '自动生成已暂停'}
              </span>{' '}
              <Button
                variant="ghost"
                onClick={() =>
                  void api
                    .configure(tenant, p)
                    .then(() => setRevision((v) => v + 1))
                    .catch((e) => {
                      setActionError(e);
                      setRevision((v) => v + 1);
                    })
                }
              >
                {p.enabled ? '暂停' : '恢复'}
              </Button>
              {p.reason && reasons[p.reason] && <p className="muted">{reasons[p.reason]}</p>}
            </div>
          ))}
      </details>
    </section>
  );
}
