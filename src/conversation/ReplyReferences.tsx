import { ChevronDown, FileText, ArrowUpRight } from 'lucide-react';
import type { KnowledgeChunk } from '../../contracts/public-api/knowledge';
import './reply-references.css';

export function ReplyReferences({
  sources,
  citation,
}: {
  sources: KnowledgeChunk[];
  citation?: (id: string) => void;
}) {
  if (!sources.length) return null;
  const files = new Map<string, KnowledgeChunk[]>();
  for (const source of sources) {
    const key = `${source.materialId}:${source.versionId}`;
    const group = files.get(key);
    if (group) group.push(source);
    else files.set(key, [source]);
  }
  return (
    <details className="reply-references reply-reference-library">
      <summary aria-label={`资料引用（${sources.length}）`}>
        <ChevronDown size={14} aria-hidden="true" />
        <span>资料引用</span>
        <span className="reply-reference-count">{sources.length}</span>
      </summary>
      <div className="reply-reference-files">
        {[...files].map(([key, fragments]) => (
          <section
            className="reply-reference-file"
            key={key}
            aria-label={`${fragments[0].filename} · v${fragments[0].version}`}
          >
            <header>
              <FileText size={16} aria-hidden="true" />
              <strong>{fragments[0].filename}</strong>
              <span className="reply-reference-version">v{fragments[0].version}</span>
            </header>
            <div className="reply-reference-locations">
              {fragments.map((source) => (
                <details className="reply-reference-fragment" key={source.id}>
                  <summary>
                    <span>{source.locator}</span>
                    {source.method === 'OCR' && <small className="reply-reference-ocr">OCR 需核对</small>}
                    <ChevronDown size={13} aria-hidden="true" />
                  </summary>
                  <div className="reply-reference-excerpt">
                    <pre>
                      {source.content.slice(0, 220)}
                      {source.content.length > 220 ? '…' : ''}
                    </pre>
                    {citation && (
                      <button
                        type="button"
                        onClick={() => citation(source.id)}
                        aria-label={`查看来源：${source.locator}`}
                      >
                        查看来源 <ArrowUpRight size={13} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}
