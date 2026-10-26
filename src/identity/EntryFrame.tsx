import type { ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { DreamcoreLogo } from '../components/DreamcoreLogo';

/** The quiet centered card shared by login, surface choice and enterprise choice. */
export function EntryFrame({ label, home, children }: { label: string; home?: string; children: ReactNode }) {
  return (
    <main className="access-auth-layout">
      {home ? (
        <a className="access-wordmark" href={home}>
          <DreamcoreLogo wordmark />
        </a>
      ) : (
        <span className="access-wordmark">
          <DreamcoreLogo wordmark />
        </span>
      )}
      <section className="access-auth-card" aria-label={label}>
        {children}
      </section>
    </main>
  );
}

/** One option row; the accessible name stays the bare option so the detail line only describes it. */
export function EntryChoice({
  id,
  name,
  detail,
  icon: Icon,
  mark,
  tone = 'accent',
  onClick,
}: {
  id: string;
  name: string;
  detail: string;
  icon?: LucideIcon;
  mark?: string;
  tone?: 'accent' | 'gold' | 'plain';
  onClick: () => void;
}) {
  const detailId = `entry-choice-${id}`;
  return (
    <button
      type="button"
      className="access-choice"
      aria-label={name}
      aria-describedby={detailId}
      onClick={onClick}
    >
      <span className={`access-choice-mark ${tone} ${mark ? 'round' : ''}`} aria-hidden="true">
        {Icon ? <Icon size={22} strokeWidth={1.7} /> : mark}
      </span>
      <span className="access-choice-text">
        <strong>{name}</strong>
        <span id={detailId}>{detail}</span>
      </span>
      <ChevronRight className="access-choice-arrow" size={18} strokeWidth={1.7} aria-hidden="true" />
    </button>
  );
}
