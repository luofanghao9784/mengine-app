/**
 * Dual-orbit Mengine mark (engine dashboard design, 2026-10-06): the solid orbit is the work loop,
 * the dashed orbit the evolution loop. Colors come from --mark-work / --mark-evolve per surface.
 */
export function DreamcoreLogo({ wordmark = false }: { wordmark?: boolean }) {
  return (
    <span
      className={`dreamcore-logo${wordmark ? ' with-wordmark' : ''}`}
      role="img"
      aria-label="Mengine · 梦擎工作空间"
    >
      <svg className="dreamcore-symbol" viewBox="0 0 40 40" fill="none" strokeWidth="1.6" aria-hidden="true">
        <ellipse cx="20" cy="20" rx="16" ry="7" transform="rotate(-45 20 20)" stroke="var(--mark-work)" />
        <ellipse
          cx="20"
          cy="20"
          rx="16"
          ry="7"
          transform="rotate(45 20 20)"
          stroke="var(--mark-evolve)"
          strokeDasharray="2 3"
        />
        <circle cx="20" cy="20" r="2.4" fill="var(--mark-work)" />
      </svg>
      {wordmark && (
        <span className="dreamcore-wordmark" aria-hidden="true">
          Mengine
          <span className="dreamcore-wordmark-cn">梦擎工作空间</span>
        </span>
      )}
    </span>
  );
}
