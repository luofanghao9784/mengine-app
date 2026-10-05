import { Sparkles, Square, RotateCw } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { generationChoices } from './generation-types';
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
  const completed = batch?.status === 'SUCCEEDED';
  return (
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
      <p>
        {(batch?.reason && reasons[batch.reason]) ||
          (completed
            ? '读取后自动显示'
            : generation.progress.total > 1
              ? `已生成 ${generation.progress.done} / ${generation.progress.total} 张`
              : '完成后自动显示')}
      </p>
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
          onClick={() => generation.generate()}
        />
      )}
      {batch && generationOpen(batch) && (
        <Button
          variant="secondary"
          className="generation-icon-button generation-stop-button"
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
  );
}
export function GenerationPanel({ generation }: { generation: BriefingGeneration }) {
  const { submission, current, active } = generation;
  const choiceName = useId();
  const [step, setStep] = useState<'start' | 'count' | 'types'>('start');
  const [count, setCount] = useState(1);
  const [types, setTypes] = useState<string[]>([]);
  const remaining = Math.min(6, generation.quota.remaining);
  const quantity = Math.min(count, Math.max(1, remaining));
  const toggleType = (type: string) =>
    setTypes((old) =>
      old.includes(type) ? old.filter((t) => t !== type) : old.length < quantity ? [...old, type] : old,
    );

  const pendingSlot = generation.active ? { batch: generation.active } : generation.pendingSlot;
  const pending = !!pendingSlot || submission.busy || submission.uncertain;
  const batch = pendingSlot?.batch;
  const loading = batch ? ['QUEUED', 'RUNNING'].includes(batch.status) : submission.busy;
  const terminal = current && !generationOpen(current) && current.status !== 'SUCCEEDED';
  return (
    <article
      className={
        'live-briefing-card briefing-generation' +
        (pending ? ' generation-placeholder' : '') +
        (pending && loading ? ' is-generating' : '')
      }
      aria-label="生成新画报"
      aria-busy={pending && (loading || !!pendingSlot?.reading)}
      data-batch-id={batch?.id}
    >
      {pending ? (
        <GenerationPlaceholder generation={generation} slot={pendingSlot} />
      ) : (
        <div className="generation-card-copy generation-chooser">
          <div className="generation-chooser-heading">
            {step !== 'start' && (
              <button
                type="button"
                className="generation-back"
                aria-label="上一步"
                onClick={() => setStep(step === 'types' ? 'count' : 'start')}
              >
                ‹
              </button>
            )}
            <h3>{step === 'start' ? '生成画报' : step === 'count' ? '生成数量' : '画报类型'}</h3>
          </div>
          {step === 'start' ? (
            <Button
              variant="primary"
              className="generation-start-button"
              icon={Sparkles}
              aria-label="生成更多"
              disabled={!generation.ready}
              onClick={() => setStep('count')}
            >
              生成
            </Button>
          ) : step === 'count' ? (
            <>
              <fieldset className="generation-types generation-counts">
                <legend>生成数量</legend>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <label key={n} className="generation-type">
                    <input
                      type="radio"
                      name={choiceName}
                      checked={quantity === n}
                      disabled={n > remaining}
                      onChange={() => {
                        setCount(n);
                        setTypes((old) => old.slice(0, n));
                      }}
                    />
                    <span>{n}</span>
                  </label>
                ))}
              </fieldset>
              <p>
                今日可用 {remaining} / {generation.quota.limit} 次
              </p>
              <Button
                variant="primary"
                className="generation-start-button"
                disabled={remaining === 0}
                onClick={() => setStep('types')}
              >
                下一步
              </Button>
            </>
          ) : (
            <>
              <fieldset className="generation-types">
                <legend>画报类型</legend>
                {generationChoices.map((choice) => (
                  <label key={choice.value} className="generation-type">
                    <input
                      type="checkbox"
                      checked={choice.value ? types.includes(choice.value) : types.length === 0}
                      disabled={!!choice.value && !types.includes(choice.value) && types.length >= quantity}
                      onChange={() => (choice.value ? toggleType(choice.value) : setTypes([]))}
                    />
                    <span>{choice.label}</span>
                  </label>
                ))}
              </fieldset>
              <p>{types.length === 0 ? '由系统判断类型' : `已选 ${types.length} 种 · 共 ${quantity} 张`}</p>
              <Button
                variant="primary"
                className="generation-start-button"
                disabled={remaining < count || types.length > quantity || submission.busy || !!active}
                onClick={() => {
                  generation.generate(quantity, types);
                  setStep('start');
                }}
              >
                生成 {quantity} 张
              </Button>
            </>
          )}
          <SubmitError error={submission.error || generation.error} uncertain={submission.uncertain} />
          {step === 'start' && (
            <p className="generation-result" role="status">
              {remaining === 0
                ? '今日额度已用完'
                : terminal
                  ? current.status === 'NO_NEW_CONTENT'
                    ? '暂无新内容'
                    : label[current.status]
                  : `每日最多 ${generation.quota.limit} 次`}
            </p>
          )}
        </div>
      )}
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
