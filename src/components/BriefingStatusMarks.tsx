import { MessageSquare, Star, ThumbsDown, ThumbsUp, type LucideIcon } from 'lucide-react';
import type { BriefingCard } from '../briefing';
import type { DemoState } from '../model';
import { briefingConversation } from '../briefingChats';
import { currentFeedback } from '../briefingFeedback';

type StatusMark = { label: string; Icon: LucideIcon; kind: string };

export function briefingStatusMarks(state: DemoState, card: BriefingCard): StatusMark[] {
  const feedback = currentFeedback(state, card.data);
  return [
    ...(feedback
      ? [
          {
            label: feedback.value === 'useful' ? '已标记有用' : '已标记没用',
            Icon: feedback.value === 'useful' ? ThumbsUp : ThumbsDown,
            kind: feedback.value,
          },
        ]
      : []),
    ...(card.pinned ? [{ label: '已关注', Icon: Star, kind: 'following' }] : []),
    ...(briefingConversation(state, card)
      ? [{ label: '已有会话', Icon: MessageSquare, kind: 'conversation' }]
      : []),
  ];
}

export function BriefingStatusMarks({ marks, header = false }: { marks: StatusMark[]; header?: boolean }) {
  if (!marks.length) return null;
  return (
    <span className={`briefing-card-marks${header ? ' briefing-header-marks' : ''}`}>
      {marks.map(({ label, Icon, kind }) => (
        <span
          key={kind}
          className={kind === 'conversation' ? 'briefing-conversation-mark' : 'briefing-status-mark'}
          data-mark={kind}
          title={label}
          role="img"
          aria-label={label}
        >
          <Icon size={17} fill={kind === 'conversation' ? 'none' : 'currentColor'} aria-hidden="true" />
        </span>
      ))}
    </span>
  );
}
