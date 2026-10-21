import { ChevronDown, FileText, ArrowUpRight } from 'lucide-react';
import type { KnowledgeChunk } from '../../contracts/public-api/knowledge';
import './reply-references.css';

export function ReplyReferences({
  sources,
  citation,
  scopeSource,
  flat = false,
}: {
  flat?: boolean;
  sources: KnowledgeChunk[];
  citation?: (id: string) => void;
  scopeSource?: { materialId: string; versionId: string; scopeExcerpt: string } | null;
}) {
  if (!sources.length) return null;
  const files = new Map<string, KnowledgeChunk[]>();
  for (const source of sources) {
    const key = `${source.materialId}:${source.versionId}`;
    const group = files.get(key);
    if (group) group.push(source);
    else files.set(key, [source]);
  }
  const Wrapper = flat ? 'section' : 'details';
  const Heading = flat ? 'h4' : 'summary';
  const Fragment = flat ? 'div' : 'details';
  const FragmentHeading = flat ? 'div' : 'summary';
  return (
    <Wrapper className="reply-references reply-reference-library">
      <Heading aria-label={`资料引用（${sources.length}）`}>
        {!flat && <ChevronDown size={14} aria-hidden="true" />}
        <span>资料引用</span>
        <span className="reply-reference-count">{sources.length}</span>
      </Heading>
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
            {scopeSource?.materialId === fragments[0].materialId &&
              scopeSource.versionId === fragments[0].versionId &&
              !fragments.some((source) => source.content === scopeSource.scopeExcerpt) && (
                <div className="reading-evidence-content">
                  <pre>{scopeSource.scopeExcerpt}</pre>
                </div>
              )}
            <div className="reply-reference-locations">
              {fragments.map((source) => (
                <Fragment className="reply-reference-fragment" key={source.id}>
                  <FragmentHeading>
                    <span>{source.locator}</span>
                    {source.method === 'OCR' && <small className="reply-reference-ocr">OCR 需核对</small>}
                    {!flat && <ChevronDown size={13} aria-hidden="true" />}
                  </FragmentHeading>
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
                </Fragment>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Wrapper>
  );
}
