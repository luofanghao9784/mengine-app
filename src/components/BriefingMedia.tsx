import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { FileText } from 'lucide-react';
import { briefingPeople, type BriefingDocument } from '../briefingMedia';
import type { CardData } from '../briefing';
import { useDemo } from '../store';

export function BriefingCardPeople({ data }: { data: CardData }) {
  const { state } = useDemo();
  const names = briefingPeople(state, data);
  const label = data.people ? '相关人员' : '项目成员';
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const bounds = root.current.getBoundingClientRect();
    const height = Math.min(280, names.length * 40 + 48);
    setAbove(bounds.bottom + height + 12 > window.innerHeight && bounds.top > height);
  }, [open, names.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  if (!names.length) return null;
  return (
    <div
      className="briefing-people"
      role="group"
      aria-label={data.people ? '本条内容相关人员' : '当前项目成员'}
      ref={root}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        className="briefing-people-trigger"
        aria-label={`查看${label}，共 ${names.length} 人`}
        aria-expanded={open}
        aria-controls={id}
        onFocus={(event) => {
          if (event.target.matches(':focus-visible')) setOpen(true);
        }}
        onClick={() => setOpen((value) => !value)}
      >
        {names.slice(0, 3).map((name) => (
          <span className="briefing-person" role="img" aria-label={name} key={name}>
            {Array.from(name)[0]}
          </span>
        ))}
        {names.length > 3 && (
          <span
            className="briefing-person briefing-people-more"
            role="img"
            aria-label={`另有 ${names.length - 3} 人：${names.slice(3).join('、')}`}
          >
            +{names.length - 3}
          </span>
        )}
      </button>
      {open && (
        <div
          className={`briefing-people-list ${above ? 'above' : ''}`}
          id={id}
          role="region"
          aria-label={`${label}姓名`}
        >
          <small>
            {label} · {names.length} 人
          </small>
          <ul>
            {names.map((name) => (
              <li key={name}>
                <span className="briefing-person" aria-hidden="true">
                  {Array.from(name)[0]}
                </span>
                <span>
                  {name}
                  {data.people?.find((p) => p.name === name)?.role && (
                    <small className="briefing-person-role">
                      {data.people.find((p) => p.name === name)!.role}
                    </small>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function BriefingDocumentCovers({ documents }: { documents: BriefingDocument[] }) {
  if (!documents.length) return null;
  const shown = documents.slice(0, 3);
  return (
    <div
      className={`briefing-document-stack ${documents.length > 1 ? 'is-stacked' : ''}`}
      role="group"
      aria-label={`关联文档，共 ${documents.length} 份：${documents.map((doc) => doc.title).join('、')}`}
      title={documents.map((doc) => doc.title).join('、')}
      style={{ '--cover-count': shown.length } as CSSProperties}
    >
      {shown.map((doc, index) => (
        <div
          className="briefing-document-cover"
          key={doc.id}
          role="img"
          aria-label={`文档封面：${doc.title}`}
          style={{ '--cover-index': index } as CSSProperties}
        >
          <div className="document-cover-type">
            <FileText size={13} aria-hidden="true" />
            {doc.type}
          </div>
          <strong>{doc.title}</strong>
          <div className="document-cover-rule" aria-hidden="true" />
          <small>工作资料</small>
        </div>
      ))}
      {documents.length > 1 && <span className="briefing-document-count">{documents.length} 份</span>}
    </div>
  );
}
