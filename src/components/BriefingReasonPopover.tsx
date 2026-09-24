import { useEffect, useRef } from 'react';
import { Check, ChevronRight, Sparkles, X } from 'lucide-react';
import { feedbackReasons, type CardFeedback, type FeedbackReason } from '../briefingFeedback';

export function BriefingReasonPopover({
  open,
  feedback,
  onClose,
  onSelect,
  onCustom,
}: {
  open: boolean;
  feedback?: CardFeedback;
  onClose: (restoreFocus?: boolean) => void;
  onSelect: (reason: FeedbackReason) => void;
  onCustom: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    panel.current
      ?.querySelector<HTMLButtonElement>('.briefing-reasons button')
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!panel.current?.parentElement?.contains(event.target as Node)) close.current();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <section
      ref={panel}
      id="briefing-reason-options"
      role="dialog"
      aria-label="选择没用的原因"
      className={`briefing-reason-popover ${open ? 'is-open' : ''}`}
      inert={!open}
      aria-hidden={!open}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
        }
      }}
    >
      <div className="briefing-panel-heading">
        <strong>哪里没帮到你？</strong>
        <button className="icon-button" aria-label="取消选择原因" onClick={() => onClose(true)}>
          <X size={17} />
        </button>
      </div>
      <div className="briefing-reasons">
        {feedbackReasons.map((reason) => (
          <button
            key={reason.id}
            aria-pressed={feedback?.reason === reason.id}
            onClick={() => onSelect(reason.id)}
          >
            {reason.label}
            {feedback?.reason === reason.id && <Check size={14} />}
          </button>
        ))}
        <button className="briefing-custom-reason" onClick={onCustom}>
          <Sparkles size={16} strokeWidth={1.65} aria-hidden="true" />
          <span>告诉 AI 如何优化</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
