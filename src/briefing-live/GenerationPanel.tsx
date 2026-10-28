import { Sparkles, RotateCw, Minus, Plus, X, Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { GenerationBatch } from '../../contracts/public-api/briefing-generation';
import { briefingTypeIcons } from './Magazine';
import { generationChoices } from './generation-types';
import type { RecommendationItem } from '../../contracts/public-api/recommendation';
import { SubmitError } from '../shared/admin';
import { Button } from '../shared/ui';
import type { MagazineGridItem } from './MagazineGrid';
import { generationOpen, type BriefingGeneration, type GenerationSlot } from './useBriefingGeneration';
import './generation.css';
import { businessReadinessReasons, generationBlocked } from './generation-reasons';

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
  ...businessReadinessReasons,
  TENANT_SERVICE_SUSPENDED: '企业服务暂停时，本次生成未完成；已发生的任务结果保留，恢复后可按需重新生成。',
  NEWS_SOURCE_UNAVAILABLE: '资讯联网搜索暂不可用，请选择其他类型。',
  PUBLIC_NEWS_READ_FAILED: '候选资讯的原文读取失败，请稍后重试。',
  PUBLIC_NEWS_CANDIDATE_LIMIT: '候选资讯核验达到本次上限，请换一个相关主题重试。',
  NEWS_NO_NEW_CONTENT: '本轮候选已报道或未满足核验要求，可重新选择生成。',
  PUBLIC_SEARCH_NOT_CONFIGURED: '资讯联网搜索尚未配置，请选择其他类型。',
  NEWS_CONTEXT_UNAVAILABLE: '请先在资料库准备企业或项目资料。',
  RESULT_NOT_READY: '尚无已完成并保存到资料库的成果。',
  NO_MATERIALS: '当前空间没有可用资料。请换到有资料的空间再生成，或先把资料加入资料库并完成解析。',
  MATERIALS_NOT_READY: '资料仍在解析，或需要处理解析问题后再生成。',
  MERGING_DATA_EVENTS: '正在等待本批资料完成更新。',
  DAILY_RUN_LIMIT: '今天的手动生成额度已用完，额度恢复后会继续。',
  AUTOMATIC_DAILY_LIMIT: '今天的自动生成额度已用完，明天继续。',
  TASK_LIMIT: '本次生成达到处理上限，尚未完成画报。',
  NO_NEW_CONTENT: '现有资料暂未支持新的分析，不重复生成旧卡。',
};
const typeLabel = (value: string | null) =>
  generationChoices.find((choice) => choice.value === (value || ''))?.label || '默认';

function explain(batch: GenerationBatch) {
  return (batch.reason && reasons[batch.reason]) || label[batch.status] || batch.status;
}

/** One card being written: each requested card holds its own place until it arrives. */
function GenerationPlaceholder({
  batch,
  index,
  total,
  queuedBehindBlock,
}: {
  batch: GenerationBatch;
  index: number;
  total: number;
  queuedBehindBlock?: boolean;
}) {
  const Icon =
    (batch.businessType && briefingTypeIcons[batch.businessType as keyof typeof briefingTypeIcons]) ||
    Sparkles;
  const running = batch.status === 'RUNNING';
  const blocked = generationBlocked(batch.status);
  const completed = batch.status === 'SUCCEEDED';
  const statusTitle = completed
    ? '正在读取新画报'
    : blocked
      ? label[batch.status]
      : batch.status === 'QUEUED'
        ? queuedBehindBlock
          ? '排队等待前序条件'
          : '排队中'
        : label[batch.status];
  const detail =
    blocked && batch.reason && reasons[batch.reason]
      ? reasons[batch.reason]
      : batch.status === 'QUEUED' && queuedBehindBlock
        ? '前一张画报还在等资料或确认，条件满足后才会开始这一张。'
        : batch.reason && reasons[batch.reason]
          ? reasons[batch.reason]
          : undefined;
  return (
    <article
      className={
        'live-briefing-card generation-pending generation-placeholder' +
        (running ? ' is-writing is-generating' : '') +
        (batch.status === 'QUEUED' && !queuedBehindBlock ? ' is-generating' : '') +
        (blocked || queuedBehindBlock ? ' is-blocked' : '')
      }
      aria-label={
        blocked
          ? `第 ${index + 1} 张画报等待条件`
          : running
            ? `正在生成第 ${index + 1} 张画报`
            : `第 ${index + 1} 张画报${statusTitle}`
      }
      aria-busy={running}
      data-batch-id={batch.id}
      data-status={batch.status}
    >
      <header>
        <span className="generation-pending-type">
          <Icon size={14} strokeWidth={1.6} />
          {batch.businessType ? typeLabel(batch.businessType) : '由梦擎决定'}
        </span>
        {total > 1 && (
          <small>
            {index + 1} / {total}
          </small>
        )}
      </header>
      <div className="generation-pending-lines" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <p role="status">
        <b>{statusTitle}</b>
        {detail && <span>{detail}</span>}
      </p>
    </article>
  );
}
export function GenerationPanel({ generation }: { generation: BriefingGeneration }) {
  const { submission, active, composing, outcome } = generation;
  const [count, setCount] = useState(1);
  const [types, setTypes] = useState<string[]>([]);
  const [topic, setTopic] = useState('');
  const remaining = Math.min(6, generation.quota.remaining);
  const quantity = Math.max(1, Math.min(count, remaining));
  const topicEnabled = !!generation.capabilities.TOPIC?.available;
  const changeQuantity = (n: number) => {
    const next = Math.max(1, Math.min(Math.max(1, remaining), Math.trunc(n) || 1));
    setCount(next);
    setTypes((old) => old.slice(0, next));
  };
  // The server deals the chosen types across the cards, so there can be no more types than cards.
  const toggleType = (type: string) => {
    if (types.includes(type)) return setTypes(types.filter((t) => t !== type));
    if (types.length >= remaining) return;
    setTypes([...types, type]);
    if (types.length + 1 > quantity) setCount(types.length + 1);
  };
  const waiting = generation.pending;
  const busy = !!active || waiting.length > 0 || submission.busy || submission.uncertain;
  const open = active || waiting.find((slot) => generationOpen(slot.batch))?.batch;
  const unreadable = waiting.some((slot) => slot.batch.status === 'SUCCEEDED' && !slot.reading);
  const blockedSlots = waiting.filter((slot) => generationBlocked(slot.batch.status));
  const runningNow =
    active?.status === 'RUNNING' || waiting.some((slot) => slot.batch.status === 'RUNNING');
  const queuedNow = waiting.some((slot) => slot.batch.status === 'QUEUED');
  const primaryBlock = blockedSlots[0]?.batch;
  const faceWorking = runningNow || (queuedNow && !blockedSlots.length) || submission.busy || submission.uncertain;
  const faceTitle =
    submission.uncertain && !open
      ? '正在确认生成请求'
      : !open && !unreadable
        ? '正在准备新画报'
        : runningNow
          ? generation.progress.total > 1
            ? `正在生成 ${Math.min(generation.progress.done + 1, generation.progress.total)} / ${generation.progress.total}`
            : '正在生成新画报'
          : blockedSlots.length && !queuedNow
            ? blockedSlots.length > 1
              ? `${blockedSlots.length} 张画报在等待条件`
              : '生成暂停，需要处理前置条件'
            : blockedSlots.length
              ? '部分画报在等待条件'
              : queuedNow
                ? generation.progress.total > 1
                  ? `排队中 ${Math.min(generation.progress.done + 1, generation.progress.total)} / ${generation.progress.total}`
                  : '排队等待开始生成'
                : generation.progress.total > 1
                  ? `正在生成 ${Math.min(generation.progress.done + 1, generation.progress.total)} / ${generation.progress.total}`
                  : '正在生成新画报';
  const faceCaption = unreadable
    ? '资料或权限变化可能导致无法读取。'
    : primaryBlock
      ? explain(primaryBlock)
      : runningNow
        ? '模型正在分析；完成后会出现在上方。'
        : queuedNow
          ? '已进入队列，轮到时会自动开始，无需反复点击。'
          : '做好的画报会依次出现在这里。';
  const start = () => {
    generation.dismissOutcome();
    generation.setComposing(true);
  };
  return (
    <article
      className={'live-briefing-card briefing-generation' + (composing && !busy ? ' is-composing' : '')}
      aria-label="生成新画报"
      aria-busy={busy && faceWorking}
    >
      {busy ? (
        <div className="generation-face" role="status">
          <span className={'generation-symbol' + (faceWorking ? ' is-working' : ' is-blocked')}>
            <Sparkles size={22} strokeWidth={1.5} />
          </span>
          <h3>{faceTitle}</h3>
          <p>{faceCaption}</p>
          <SubmitError error={submission.error || generation.error} uncertain={submission.uncertain} />
          {!open && submission.uncertain && (
            <Button icon={RotateCw} disabled={submission.busy} onClick={() => generation.generate()}>
              重试本次请求
            </Button>
          )}
          {open && (
            <Button
              variant="ghost"
              aria-label="取消本次"
              disabled={!!generation.cancelBusy}
              onClick={() => void generation.cancel(open.id)}
            >
              {primaryBlock ? '取消并停止等待' : '取消本次生成'}
            </Button>
          )}
          {unreadable && !open && (
            <div className="generation-actions">
              <Button icon={RotateCw} onClick={generation.refresh}>
                重新读取
              </Button>
              <Button variant="ghost" aria-label="返回生成首页" onClick={generation.dismissUnavailable}>
                不再等待
              </Button>
            </div>
          )}
        </div>
      ) : composing ? (
        <form
          className="generation-compose"
          onSubmit={(event) => {
            event.preventDefault();
            generation.generate(quantity, types, topicEnabled ? topic : '');
          }}
        >
          <header>
            <h3>生成新画报</h3>
            <button
              type="button"
              className="generation-back"
              aria-label="返回生成首页"
              title="收起"
              onClick={() => generation.setComposing(false)}
            >
              <X size={16} />
            </button>
          </header>
          {topicEnabled && (
            <input
              className="generation-topic"
              aria-label="想看的主题"
              placeholder="想看什么主题？可以不填，例如：华东区回款"
              maxLength={80}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
            />
          )}
          <fieldset className="generation-type-tags">
            <legend>想看哪类</legend>
            {generationChoices.map((choice) => {
              const Icon = choice.value ? briefingTypeIcons[choice.value] : Sparkles;
              const unavailable = choice.value === 'INFO' && !generation.capabilities.INFO?.available;
              const checked = choice.value ? types.includes(choice.value) : types.length === 0;
              return (
                <label
                  key={choice.value}
                  className="magazine-type generation-type"
                  data-briefing-type={choice.value ? choice.label : '全部'}
                  title={
                    unavailable
                      ? generation.capabilities.INFO?.reason === 'PUBLIC_WEB_UNAVAILABLE'
                        ? '资讯联网能力未启用'
                        : '资讯联网搜索未配置'
                      : undefined
                  }
                >
                  <input
                    type="checkbox"
                    aria-label={choice.label}
                    checked={checked}
                    disabled={unavailable || (!!choice.value && !checked && types.length >= remaining)}
                    onChange={() => (choice.value ? toggleType(choice.value) : setTypes([]))}
                  />
                  <Icon size={14} strokeWidth={1.6} />
                  <span>{choice.value ? choice.label : '由梦擎决定'}</span>
                  {unavailable && <small className="generation-type-unavailable">未启用</small>}
                </label>
              );
            })}
          </fieldset>
          <div className="generation-count">
            <span id="generation-count-label">要几张</span>
            <div className="generation-quantity">
              <Button
                variant="ghost"
                icon={Minus}
                aria-label="减少数量"
                disabled={quantity <= Math.max(1, types.length)}
                onClick={() => changeQuantity(quantity - 1)}
              />
              <input
                type="number"
                aria-label="生成数量"
                min={1}
                max={Math.max(1, remaining)}
                value={quantity}
                onChange={(event) => changeQuantity(Number(event.target.value))}
              />
              <Button
                variant="ghost"
                icon={Plus}
                aria-label="增加数量"
                disabled={quantity >= remaining}
                onClick={() => changeQuantity(quantity + 1)}
              />
            </div>
            <small>今日还可生成 {remaining} 张</small>
          </div>
          <Button
            type="submit"
            variant="primary"
            icon={Sparkles}
            className="generation-submit"
            disabled={
              remaining < quantity ||
              (types.includes('INFO') && !generation.capabilities.INFO?.available) ||
              submission.busy
            }
          >
            生成 {quantity} 张
          </Button>
          <SubmitError error={submission.error || generation.error} uncertain={submission.uncertain} />
        </form>
      ) : (
        <div className="generation-face">
          {outcome && (
            <button
              type="button"
              className="generation-back"
              aria-label="收起本次结果"
              title="知道了"
              onClick={generation.dismissOutcome}
            >
              <X size={16} />
            </button>
          )}
          <span className={'generation-symbol' + (outcome?.delivered ? ' is-done' : '')}>
            {outcome?.delivered ? (
              <Check size={22} strokeWidth={1.8} />
            ) : (
              <Sparkles size={22} strokeWidth={1.5} />
            )}
          </span>
          <h3>
            {outcome
              ? outcome.delivered
                ? `生成了 ${outcome.delivered} 张新画报`
                : '这次没有生成新画报'
              : '再来几张'}
          </h3>
          <p className="generation-result" role="status">
            {outcome?.missed.length
              ? `${outcome.delivered ? `另有 ${outcome.missed.length} 张未生成：` : ''}${
                  (outcome.missed[0].reason && reasons[outcome.missed[0].reason]) ||
                  label[outcome.missed[0].status]
                }`
              : remaining === 0
                ? '今日额度已用完，明天继续。'
                : outcome
                  ? '新画报已经排在上面。'
                  : '基于已有资料，生成新的画报。'}
          </p>
          <Button
            variant={outcome ? 'secondary' : 'primary'}
            icon={Sparkles}
            aria-label="生成更多"
            disabled={!generation.ready || remaining === 0}
            onClick={start}
          >
            {outcome ? '再来几张' : '生成新画报'}
          </Button>
          {!outcome && remaining > 0 && <small>今日还可生成 {remaining} 张</small>}
          <SubmitError error={submission.error || generation.error} uncertain={submission.uncertain} />
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
      news: slot.item!.briefing?.content.businessType === 'INFO',
      render: <div className="generation-arrived">{render(slot.item!)}</div>,
    }));
  const total = Math.max(generation.progress.total, generation.pending.length);
  const anyBlocked = generation.pending.some((slot) => generationBlocked(slot.batch.status));
  generation.pending.forEach((slot, index) =>
    items.push({
      id: 'generation:pending:' + slot.batch.id,
      atEnd: true,
      title: '',
      summary: '',
      fixedSize: '1×1',
      render: (
        <GenerationPlaceholder
          batch={slot.batch}
          index={total - generation.pending.length + index}
          total={total}
          queuedBehindBlock={slot.batch.status === 'QUEUED' && anyBlocked}
        />
      ),
    }),
  );
  const busy = !!generation.active || generation.pending.length > 0 || generation.submission.busy;
  items.push({
    id: 'generation:more',
    atEnd: true,
    title: '',
    summary: '',
    // Choosing needs room: two cells wide, or two tall where the page has a single column.
    fixedSize:
      generation.composing && !busy ? (matchMedia('(max-width: 560px)').matches ? '1×2' : '2×1') : '1×1',
    render: <GenerationPanel generation={generation} />,
  });
  return items;
}
