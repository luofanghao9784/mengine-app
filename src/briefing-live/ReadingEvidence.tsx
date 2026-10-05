import type { ReactNode } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import '../conversation/reply-references.css';
import './reading-evidence.css';

export function ReadingEvidence({
  title,
  filename,
  version,
  children,
}: {
  title: string;
  filename?: string;
  version?: number;
  children: ReactNode;
}) {
  return (
    <details className="reply-references reply-reference-library reading-evidence">
      <summary>
        <ChevronDown size={14} aria-hidden="true" />
        <span>{title}</span>
      </summary>
      <div className="reply-reference-files">
        <section className="reply-reference-file">
          {filename && (
            <header>
              <FileText size={16} aria-hidden="true" />
              <strong>{filename}</strong>
              {version !== undefined && <span className="reply-reference-version">v{version}</span>}
            </header>
          )}
          <div className="reading-evidence-content">{children}</div>
        </section>
      </div>
    </details>
  );
}
