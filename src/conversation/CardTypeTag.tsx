/** A consistent type label for readers and conversation companion cards. */
export function CardTypeTag({ type }: { type: '资料' | '会话' | '画报' | '进展' | '成果' }) {
  return <span className="live-card-type-tag">{type}</span>;
}
