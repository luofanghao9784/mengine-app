import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowUpRight, type LucideIcon } from 'lucide-react';
export function Button({
  children,
  variant = 'secondary',
  icon: Icon,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: LucideIcon;
}) {
  return (
    <button type="button" className={`button ${variant} ${className}`} {...props}>
      {Icon && <Icon size={16} strokeWidth={1.7} aria-hidden="true" />}
      {children}
    </button>
  );
}
export function IconButton({
  icon: Icon,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button type="button" className="icon-button" aria-label={label} title={label} {...props}>
      <Icon size={18} strokeWidth={1.65} />
    </button>
  );
}
export const Badge = ({ children, blue = false }: { children: ReactNode; blue?: boolean }) => (
  <span className={`badge ${blue ? 'blue' : ''}`}>{children}</span>
);
export function Empty({
  icon: Icon,
  title,
  text,
  children,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={28} strokeWidth={1.4} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
export const PageTitleContext = createContext<HTMLDivElement | null>(null);

export function PageTitle({ children }: { children: ReactNode }) {
  const target = useContext(PageTitleContext);
  return target ? createPortal(children, target) : null;
}

export const PageActionsContext = createContext<HTMLDivElement | null>(null);

export function PageActions({
  children,
  placement = 'actions',
}: {
  children: ReactNode;
  placement?: 'actions' | 'meta' | 'header';
}) {
  const target = useContext(PageActionsContext);
  const container =
    placement === 'header'
      ? target?.parentElement
      : placement === 'meta'
        ? target?.parentElement?.querySelector('.topbar-meta')
        : target;
  return container ? createPortal(children, container) : null;
}
export function SectionHeading({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {action && (
        <Button variant="ghost" onClick={onAction}>
          {action}
          <ArrowUpRight size={14} />
        </Button>
      )}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    const trigger = document.activeElement;
    el?.showModal();
    return () => {
      el?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''} ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
            onClose();
        }
      }}
      aria-labelledby={titleId}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <IconButton icon={X} label="关闭弹窗" onClick={onClose} />
      </header>
      <div className="modal-content">{children}</div>
    </dialog>,
    document.body,
  );
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function DocumentText({ text }: { text: string }) {
  // Render the small Markdown subset used by our editable documents; never inject HTML.
  const inline = (line: string) =>
    line.split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*)/g).map((part, i) => {
      const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (link)
        return (
          <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer">
            {link[1]}
          </a>
        );
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
      return part;
    });
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((s) => s.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('|') && /^\s*\|[\s:|\-]+\|\s*$/.test(lines[i + 1] || '')) {
      const headers = cells(line);
      const rows: string[][] = [];
      const key = i;
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      i--;
      nodes.push(
        <div className="document-table-scroll" key={key}>
          <table>
            <thead>
              <tr>
                {headers.map((v, j) => (
                  <th key={j}>{inline(v)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, j) => (
                <tr key={j}>
                  {row.map((v, k) => (
                    <td key={k}>{inline(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^#{1,6}\s|^[一二三四五六七八九十]+、/.test(line)) {
      nodes.push(<h3 key={i}>{inline(line.replace(/^#{1,6}\s+/, ''))}</h3>);
    } else if (/^>\s?/.test(line)) {
      nodes.push(
        <p className="document-note" key={i}>
          {inline(line.replace(/^>\s?/, ''))}
        </p>,
      );
    } else {
      nodes.push(<p key={i}>{inline(line.replace(/^[-*]\s+/, '• ')) || '\u00a0'}</p>);
    }
  }
  return <div className="document-text">{nodes}</div>;
}
