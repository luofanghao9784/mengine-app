import { briefingTypeLabels } from './content';
import type { BriefingDocument } from '../../contracts/public-api/briefing-content';
import { DataBriefing } from './DataBriefing';
import { FileText, MessageSquare, Star, type LucideIcon } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { NavIconButton, useNavHover } from '../components/NavIconButton';

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
  if (briefing)
    return (
      <>
        <div className="data-briefing-type">
          {briefingTypeLabels[briefing.content.businessType]}{' '}
          <time>{new Date(date).toLocaleDateString('zh-CN')}</time>
        </div>
        <h3>{briefing.content.title}</h3>
        <DataBriefing document={briefing} compact />
        <span className="data-briefing-generated">{workspace} · 有计算依据</span>
        <BriefingStatusMarks pinned={pinned} />
      </>
    );
  const Icon = publication ? FileText : MessageSquare;
  return (
    <>
      <div className="live-magazine-eyebrow">
        <span className={'live-magazine-type ' + (publication ? 'publication' : '')}>
          <Icon size={14} />
          {publication ? '企业副本' : '会话'}
        </span>
        <time dateTime={date}>
          {new Date(date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
        </time>
      </div>
      <h3>{title}</h3>
      <p className="live-briefing-excerpt">
        {excerpt}
        {truncated ? '…' : ''}
      </p>
      <div className="live-magazine-footer">
        <span>{workspace}</span>
        {footer}
      </div>
      {verification && <span className="live-verification-label">联调验证 · 未调用真实模型</span>}
      <BriefingStatusMarks pinned={pinned} conversation={!publication} />
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
