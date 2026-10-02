import { briefingTypeLabels } from './content';
import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { BriefingChart } from './DataBriefing';
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
import { useRef, type ReactNode } from 'react';
import { NavIconButton, useNavHover } from '../components/NavIconButton';
import { briefingTime } from '../briefingTypography';
import '../briefingMagazine.css';

const icons = {
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
}: {
  pinned?: boolean;
  conversation?: boolean;
}) {
  return (
    <span className="live-briefing-marks">
      {pinned && (
        <span role="img" aria-label="已关注" title="已关注">
          <Star size={16} fill="currentColor" />
        </span>
      )}
      {conversation && (
        <span role="img" aria-label="来自会话" title="来自会话">
          <MessageSquare size={16} />
        </span>
      )}
    </span>
  );
}

export function MagazineBody({
  title,
  excerpt,
  truncated,
  workspace,
  date,
  publication = false,
  pinned = false,
  verification = false,
  footer,
  briefing,
}: {
  title: string;
  excerpt: string;
  truncated: boolean;
  workspace: string;
  date: string;
  publication?: boolean;
  pinned?: boolean;
  verification?: boolean;
  footer?: ReactNode;
  briefing?: BriefingDocument | null;
}) {
  const content = briefing?.content;
  const chart = content?.chart;
  const type = content ? briefingTypeLabels[content.businessType] : publication ? '成果' : '会话';
  const Icon = content ? icons[content.businessType] : publication ? FileCheck2 : MessagesSquare;
  const summary = content?.summary ?? excerpt;
  return (
    <>
      <div
        className={`briefing-magazine live-magazine magazine-${type}${chart ? ' magazine-with-chart' : ''}`}
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
          <div className="magazine-copy">
            <h3>{content?.title ?? title}</h3>
            {chart && <BriefingChart document={briefing!} compact />}
            <p className="magazine-summary live-briefing-excerpt" title={summary}>
              {summary}
              {!content && truncated ? '…' : ''}
            </p>
          </div>
        </div>
        <div className="magazine-footer live-magazine-footer">
          <span>
            {workspace}
            {publication ? ' · 企业副本' : ''}
          </span>
          {footer}
        </div>
        {verification && <span className="live-verification-label">联调验证 · 未调用真实模型</span>}
      </div>
      <BriefingStatusMarks pinned={pinned} conversation={!publication && !briefing} />
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
