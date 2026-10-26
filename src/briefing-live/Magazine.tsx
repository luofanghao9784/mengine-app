import { legacyEditorialLayout, verificationEditionSize } from './editorial-policy';
import { PendingReceipts, pendingReceipts } from './PendingReceipts';
import { DiscussionMark, type DiscussionSource } from './DiscussionMark';
import { KeyMetric, AnalysisComposition, SourceCover } from './Composition';
import { presentationOf } from './presentation';
import { NewsCover } from './NewsCover';
import { FeedbackMark } from './FeedbackMark';
import type { FeedbackTarget } from '../../contracts/public-api/feedback';
import { briefingTypeLabels } from './content';
import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { CardFace } from './CardFace';
import {
  ChartNoAxesCombined,
  FileCheck2,
  Lightbulb,
  MessagesSquare,
  Newspaper,
  Signpost,
  MessageSquare,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { NavIconButton, useNavHover } from '../components/NavIconButton';
import { briefingTime } from '../briefingTypography';
import '../briefingMagazine.css';

export const briefingTypeIcons = {
  INFO: Newspaper,
  DATA: ChartNoAxesCombined,
  INSIGHT: Lightbulb,
  SUGGESTION: Signpost,
  RESULT: FileCheck2,
};

/** Presentation only: all labels and state must come from an authorized API result. */
export function BriefingStatusMarks({
  pinned = false,
  conversation = false,
  feedback,
  discussion,
}: {
  pinned?: boolean;
  conversation?: boolean;
  feedback?: { tenant: string; target: FeedbackTarget };
  discussion?: { tenant: string; source: DiscussionSource };
}) {
  return (
    <span className="live-briefing-marks">
      {feedback && <FeedbackMark {...feedback} />}
      {pinned && (
        <span role="img" aria-label="已关注" title="已关注">
          <Star size={16} fill="currentColor" />
        </span>
      )}
      {discussion && <DiscussionMark {...discussion} />}
      {conversation && (
        <span role="img" aria-label="AI 生成" title="AI 生成">
          <MessageSquare size={16} />
        </span>
      )}
    </span>
  );
}

export function MagazineBody({
  compact = false,
  title,
  excerpt,
  truncated,
  workspace,
  date,
  publication = false,
  pinned = false,
  footer,
  briefing,
  feedback,
  discussion,
}: {
  compact?: boolean;
  title: string;
  excerpt: string;
  truncated: boolean;
  workspace: string;
  date: string;
  publication?: boolean;
  pinned?: boolean;
  footer?: ReactNode;
  briefing?: BriefingDocument | null;
  feedback?: { tenant: string; target: FeedbackTarget };
  discussion?: { tenant: string; source: DiscussionSource };
}) {
  const content = briefing?.content;
  const summaryOnly = content && verificationEditionSize(content.title) === '1×1';
  const pending = compact ? null : pendingReceipts(briefing);
  const presentation = briefing ? presentationOf(briefing) : null;
  const composed =
    !compact && !summaryOnly && !!presentation && presentation.layout !== 'EDITORIAL';
  const chart = compact ? undefined : content?.chart;
  const type = content ? briefingTypeLabels[content.businessType] : publication ? '成果' : '会话';
  const Icon = content ? briefingTypeIcons[content.businessType] : publication ? FileCheck2 : MessagesSquare;
  const summary = content?.summary ?? excerpt;
  const copyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const copy = copyRef.current;
    const paragraph = copy?.querySelector<HTMLElement>('.magazine-summary');
    if (!copy || !paragraph || chart || compact || composed) return;
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(paragraph).lineHeight);
      // DOM rectangles include the mobile grid zoom; CSS line-height does not.
      const scale = copy.offsetHeight ? copy.getBoundingClientRect().height / copy.offsetHeight : 1;
      const available = (copy.getBoundingClientRect().bottom - paragraph.getBoundingClientRect().top) / scale;
      const lines = Math.max(1, Math.floor((available + 0.5) / lineHeight));
      paragraph.style.webkitLineClamp = String(lines);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(copy);
    for (const child of copy.children) if (child !== paragraph) observer.observe(child);
    measure();
    return () => observer.disconnect();
  }, [summary, title, content?.title, chart, compact, composed]);
  return (
    <>
      <div
        className={`briefing-magazine live-magazine magazine-${type}${content?.businessType === 'SUGGESTION' && (verificationEditionSize(content.title) ?? legacyEditorialLayout(content.title)) === '1×2' ? ' magazine-refund-portrait' : ''}${content?.businessType === 'SUGGESTION' && (verificationEditionSize(content.title) ?? legacyEditorialLayout(content.title)) === '2×1' ? ' magazine-followup-landscape' : ''}${chart ? ' magazine-with-chart' : ''}${chart && presentation?.chartStyle !== 'TABLE' ? ' magazine-with-face' : ''}${composed ? ' magazine-with-composition' : ''}${content?.businessType === 'INFO' ? ' magazine-with-cover' : ''}`}
        data-presentation={presentation?.layout ?? 'EDITORIAL'}
        data-magazine-type={type}
      >
        <div className="magazine-eyebrow live-magazine-eyebrow">
          <span className="magazine-type">
            <Icon size={14} aria-hidden="true" />
            {type}
          </span>
          <time dateTime={date} title={`产生时间：${briefingTime(date, true)}`}>
            {briefingTime(date)}
          </time>
        </div>
        <div className="magazine-main">
          <div className="magazine-copy" ref={copyRef}>
            {content?.businessType === 'INFO' && (
              <NewsCover cover={briefing?.cover} seed={content.title} compact />
            )}
            <h3>{pending ? `梵华里${pending.total}笔历史收款记录待核对` : content?.title ?? title}</h3>
            {!pending && !compact && briefing && <KeyMetric document={briefing} />}
            {pending ? <PendingReceipts data={pending} /> : chart && <CardFace document={briefing!} />}
            <p className="magazine-summary live-briefing-excerpt" title={summary}>
              {summary}
              {!content && truncated ? '…' : ''}
            </p>
            {!compact && briefing && content?.businessType !== 'INFO' && <SourceCover document={briefing} />}
            {!compact && !summaryOnly && briefing && content?.businessType !== 'INFO' && presentation?.layout !== 'EDITORIAL' && !chart && <AnalysisComposition document={briefing} compact />}
          </div>
        </div>
        <div className="magazine-footer live-magazine-footer">
          <span>
            {content?.schemaVersion === 'briefing-chain-v1' ? '获准门店汇总' : workspace}
            {publication ? ' · 企业副本' : ''}
          </span>
          {footer}
        </div>
      </div>
      <BriefingStatusMarks
        feedback={feedback}
        pinned={pinned}
        conversation={!publication && !briefing}
        discussion={discussion}
      />
    </>
  );
}

export function RailButton({
  label,
  icon: Icon,
  active,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { expanded, interaction } = useNavHover(ref);
  return (
    <div ref={ref} className="live-rail-action">
      <NavIconButton
        {...props}
        type="button"
        label={label}
        Icon={Icon}
        active={active}
        expanded={expanded === 'action'}
        interaction={interaction('action')}
        accessory={children}
      />
    </div>
  );
}
