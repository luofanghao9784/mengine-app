import type { ReactNode } from 'react';

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
    <section className="reading-evidence">
      {title && <h4>{title}</h4>}
      {filename && <p><strong>{filename}</strong>{version !== undefined && ` · v${version}`}</p>}
      <div className="reading-evidence-content">{children}</div>
    </section>
  );
}
