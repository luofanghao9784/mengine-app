import { type ReactNode, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import './disclosure.css';

/** Native disclosure semantics preserve keyboard access and hidden-content focus handling. */
export function Disclosure({ title, description, count, countUnit = '项', children, className = '', onOpenChange }: {
  title: string;
  description?: string;
  count?: number;
  countUnit?: string;
  children: ReactNode;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className={`disclosure ${className}`} onToggle={(event) => {
      const next = event.currentTarget.open;
      setOpen(next);
      onOpenChange?.(next);
    }}>
      <summary aria-label={title}>
        <ChevronRight className="disclosure-chevron" size={18} aria-hidden="true" />
        <span className="disclosure-heading"><span className="disclosure-title">{title}{count !== undefined && <span className="disclosure-count">{count}{countUnit}</span>}</span>{description && <span className="disclosure-description">{description}</span>}</span>
        <span className="disclosure-state" aria-hidden="true">{open ? '收起' : '展开'}</span>
      </summary>
      <div className="disclosure-content">{children}</div>
    </details>
  );
}
