import symbolUrl from '/favicon.svg?url';
/** The original orbit mark and wordmark from website/dist/index.html. */
export function DreamcoreLogo({ wordmark = false }: { wordmark?: boolean }) {
  return (
    <span
      className={`dreamcore-logo${wordmark ? ' with-wordmark' : ''}`}
      role="img"
      aria-label="Mengine · 梦擎工作空间"
    >
      <img className="dreamcore-symbol" src={symbolUrl} alt="" />
      {wordmark && (
        <span className="dreamcore-wordmark" aria-hidden="true">
          Mengine
          <span className="dreamcore-wordmark-cn">梦擎工作空间</span>
        </span>
      )}
    </span>
  );
}
