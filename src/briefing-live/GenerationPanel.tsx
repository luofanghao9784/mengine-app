import { Sparkles, Square, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RecommendationItem } from '../../contracts/public-api/recommendation';
import { SubmitError } from '../shared/admin';
import { Button } from '../shared/ui';
import type { MagazineGridItem } from './MagazineGrid';
import { generationOpen, type BriefingGeneration, type GenerationSlot } from './useBriefingGeneration';
import './generation.css';

const label: Record<string, string> = {
  QUEUED: '正在准备新画报',
  RUNNING: '正在分析资料',
  WAITING_DATA: '等待资料就绪',
  WAITING_RESOURCE: '等待可用额度',
  WAITING_CAPABILITY: '等待主模型可用',
  SUCCEEDED: '新画报已生成',
  NO_NEW_CONTENT: '暂无更多新内容',
  FAILED: '本次生成未完成',
  CANCELLED: '已取消本次生成',
  AUTHORITY_REVOKED: '资料权限已变化',
};
const reasons: Record<string, string> = {
  TENANT_SERVICE_SUSPENDED: '企业服务暂停时，本次生成未完成；已发生的任务结果保留，恢复后可按需重新生成。',
  NEWS_SOURCE_UNAVAILABLE: '资讯来源尚未接入，接入后会自动筛选相关资讯。',
  NEWS_CONTEXT_UNAVAILABLE: '请先在资料库准备企业或项目资料。',
  RESULT_NOT_READY: '尚无已完成并保存到资料库的成果。',
  NO_MATERIALS: '先将资料加入资料库，资料就绪后会自动继续。',
  MATERIALS_NOT_READY: '资料仍在解析，或需要处理解析问题。',
  MERGING_DATA_EVENTS: '正在等待本批资料完成更新。',
  DAILY_RUN_LIMIT: '今天的生成额度已用完，额度恢复后会继续。',
  TASK_LIMIT: '主模型达到本次执行上限，可稍后重试。',
  NO_NEW_CONTENT: '现有资料暂未支持新的分析，不重复生成旧卡。',
};
function GenerationPlaceholder({
  generation,
  slot,
}: {
  generation: BriefingGeneration;
  slot?: GenerationSlot;
}) {
  const batch = slot?.batch;
  const loading = batch ? ['QUEUED', 'RUNNING'].includes(batch.status) : generation.submission.busy;
  const completed = batch?.status === 'SUCCEEDED';
  return (
    <article
      className={
        'live-briefing-card briefing-generation generation-placeholder' + (loading ? ' is-generating' : '')
      }
      aria-label="生成新画报"
      aria-busy={loading || !!slot?.reading}
      data-batch-id={batch?.id}
    >
      <div className="generation-card-copy" role="status">
        <span className="generation-symbol">
          <Sparkles size={26} strokeWidth={1.5} />
        </span>
        <h3>
          {batch
            ? completed
              ? slot?.reading
                ? '正在读取新画报'
                : '新画报暂不可读取'
              : label[batch.status]
            : generation.submission.uncertain
              ? '正在确认生成请求'
              : '正在准备新画报'}
        </h3>
        <p>{(batch?.reason && reasons[batch.reason]) || (completed ? '读取后自动显示' : '完成后自动显示')}</p>
        <SubmitError
          error={generation.submission.error || generation.error}
          uncertain={generation.submission.uncertain}
        />
        {!batch && generation.submission.uncertain && (
          <Button
            className="generation-icon-button"
            icon={RotateCw}
            aria-label="重试本次请求"
            title="重试本次请求"
            disabled={generation.submission.busy}
            onClick={generation.generate}
          />
        )}
        {batch && generationOpen(batch) && (
          <Button
            variant="ghost"
            className="generation-icon-button"
            icon={Square}
            aria-label="取消本次"
            title="取消生成"
            disabled={!!generation.cancelBusy}
            onClick={() => void generation.cancel(batch.id)}
          />
        )}
        {completed && !slot?.reading && (
          <Button
            variant="ghost"
            className="generation-icon-button"
            icon={RotateCw}
            aria-label="重新读取"
            title="重新读取"
            onClick={generation.refresh}
          />
        )}
      </div>
    </article>
  );
}
export function GenerationPanel({ generation }: { generation: BriefingGeneration }) {
  const { submission, current, active } = generation;
  const pendingSlot = generation.active ? { batch: generation.active } : generation.pendingSlot;
  if (pendingSlot || submission.busy || submission.uncertain)
    return <GenerationPlaceholder generation={generation} slot={pendingSlot} />;
  const terminal = current && !generationOpen(current) && current.status !== 'SUCCEEDED';
  return (
    <article className="live-briefing-card briefing-generation" aria-label="生成新画报">
      <div className="generation-card-copy">
        <h3>发现新内容</h3>
        <p
          className="generation-result"
          role={terminal ? 'status' : undefined}
          title={terminal && current.reason ? reasons[current.reason] : undefined}
        >
          {terminal
            ? current.reason === 'TASK_LIMIT'
              ? '本次未完成，可稍后重试'
              : (current.reason && reasons[current.reason]) || label[current.status]
            : '基于已有资料，生成新的画报'}
        </p>
        <SubmitError error={submission.error || generation.error} uncertain={submission.uncertain} />
        <Button
          className="generation-icon-button"
          icon={Sparkles}
          aria-label="生成更多"
          title="生成更多"
          disabled={!generation.ready || submission.busy || !!active}
          onClick={generation.generate}
        />
      </div>
    </article>
  );
}
export function generationTiles(
  generation: BriefingGeneration,
  render: (item: RecommendationItem) => ReactNode,
): MagazineGridItem[] {
  const items: MagazineGridItem[] = generation.slots
    .filter((slot) => !!slot.item)
    .map((slot) => ({
      id: 'generation:' + slot.batch.id,
      title: slot.item!.briefing?.content.title ?? slot.item!.content.title,
      summary: slot.item!.briefing?.content.summary ?? slot.item!.content.excerpt,
      chart: !!slot.item!.briefing?.content.chart,
      render: render(slot.item!),
    }));
  items.push({
    id: 'generation:more',
    title: '',
    summary: '',
    fixedSize: '1×1',
    render: <GenerationPanel generation={generation} />,
  });
  return items;
}
