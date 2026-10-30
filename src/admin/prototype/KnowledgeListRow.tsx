import { displayText } from '../display-labels';
import type { Tone } from './data';

export function KnowledgeListRow({ name, summary, side, tone = 'plain', selected, onSelect, label }: {
  name: string; summary: string; side?: string; tone?: Tone;
  selected: boolean; onSelect: () => void; label?: string;
}) {
  return <button type="button" className="row knowledge-list-row" aria-label={label} aria-pressed={selected} onClick={onSelect}>
    <i className={`tone-${tone}`} />
    <span className="t"><b>{displayText(name)}</b><span className={tone === 'bad' ? 'tone-bad-text' : undefined}>{displayText(summary)}</span></span>
    <span className="s">{displayText(side)}</span>
  </button>;
}
