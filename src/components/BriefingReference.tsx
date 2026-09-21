import { BriefingCardPeople } from './BriefingMedia';
import { canReadCardData, localDate, type BriefingReference } from '../briefing';
import type { Chat, Message } from '../model';
import { BriefingCardBody } from '../pages/Briefing';
import { useDemo, useUI } from '../store';
import { FileText } from 'lucide-react';
import { Button } from './ui';

// Old browser records keep their message text; render their current source without resetting data.
export function messageBriefingReference(chat: Chat, message: Message): BriefingReference | undefined {
  if (message.briefing) return message.briefing;
  const context = chat.briefingContext;
  if (context?.purpose !== 'content' || message.role !== 'assistant') return;
  const data = context.snapshot;
  if (
    !['来自智能画报', '回看留存快照'].some(
      (prefix) =>
        message.text ===
        `${prefix} · ${localDate(context.asOf)}\n${data.title}\n${data.fact}\n${data.advice}\n依据：${data.source}`,
    )
  )
    return;
  return {
    cardId: context.cardId,
    asOf: context.asOf,
    snapshot: data,
    config: context.display || { title: data.title, size: data.size, compact: false },
  };
}

export function BriefingReferenceCard({
  reference,
  active,
  onSend,
}: {
  reference: BriefingReference;
  active: boolean;
  onSend: (text: string) => void;
}) {
  const { state } = useDemo();
  const ui = useUI();
  if (!canReadCardData(state, reference.snapshot))
    return <p className="subtle">这张卡片的来源已不可访问。</p>;
  return (
    <section className="briefing-reference" aria-label="会话中的画报原卡片">
      <div className="briefing-reference-caption">来自智能画报 · {localDate(reference.asOf)} 留存</div>
      <article
        className={`briefing-card template-${reference.snapshot.template}`}
        data-size={reference.config.size}
      >
        <div className="briefing-card-main">
          <BriefingCardBody data={reference.snapshot} config={reference.config} at={reference.asOf} />
        </div>
        <BriefingCardPeople data={reference.snapshot} />
      </article>
      {!!reference.snapshot.refs?.length && (
        <div className="source-row" aria-label="卡片依据">
          {reference.snapshot.refs.map((id) => {
            const material = state.materials.find((d) => d.id === id);
            return (
              material && (
                <button className="source-chip" key={id} onClick={() => ui.preview(id)}>
                  <FileText size={14} />
                  <span>{material.title}</span>
                </button>
              )
            );
          })}
        </div>
      )}
      {active && (
        <div className="chat-actions briefing-prompts" aria-label="建议提示词">
          {reference.snapshot.prompts.map((prompt) => (
            <Button key={prompt} onClick={() => onSend(prompt)}>
              {prompt}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
