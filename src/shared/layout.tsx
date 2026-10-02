import type { ReactNode, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';

export function PageHeader({
  heading,
  actions,
  meta,
  actionsRef,
  className = '',
}: {
  heading: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  actionsRef?: Ref<HTMLDivElement>;
  className?: string;
}) {
  return (
    <header className={`topbar ${className}`}>
      <div className="row min-zero topbar-heading">{heading}</div>
      <div className="topbar-actions" ref={actionsRef}>
        {actions}
      </div>
      <div className="row topbar-meta">{meta}</div>
    </header>
  );
}

export function NavigationButton({
  label,
  icon: Icon,
  active,
  href,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="nav-symbol">
        <Icon size={21} strokeWidth={1.65} aria-hidden="true" />
      </span>
      <span className="nav-label" aria-hidden="true">
        {label}
      </span>
    </>
  );
  const props = {
    className: `nav-link ${active ? 'active' : ''}`,
    'aria-label': label,
    'aria-current': active ? ('page' as const) : undefined,
  };
  return href ? (
    <a {...props} href={href} onClick={onClick}>
      {content}
    </a>
  ) : (
    <button type="button" {...props} onClick={onClick}>
      {content}
    </button>
  );
}
