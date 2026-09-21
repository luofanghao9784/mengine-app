/** The original orbit mark and wordmark from website/dist/index.html. */
export function DreamcoreLogo({ wordmark = false }: { wordmark?: boolean }) {
  return (
    <span
      className={`dreamcore-logo${wordmark ? ' with-wordmark' : ''}`}
      role="img"
      aria-label="AI Dreamcore · 梦核工作空间"
    >
      <img className="dreamcore-symbol" src="./favicon.svg" alt="" />
      {wordmark && (
        <span className="dreamcore-wordmark" aria-hidden="true">
          AI Dreamcore
          <span className="dreamcore-wordmark-cn">梦核工作空间</span>
        </span>
      )}
    </span>
  );
}
