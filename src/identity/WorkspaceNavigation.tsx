import { useEffect, useState } from 'react';
import { Grid2X2, type LucideIcon } from 'lucide-react';
import { NavigationButton } from '../shared/layout';
import { Modal } from '../shared/ui';

export type WorkspaceLink = { label: string; icon: LucideIcon; href: string; active?: boolean };

/** Real workspace routes, using the same quiet icon rail as the approved Demo. */
export function WorkspaceNavigation({
  primary,
  more,
  routeKey,
}: {
  primary: WorkspaceLink[];
  more: WorkspaceLink[];
  routeKey: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [routeKey]);
  return (
    <>
      {primary.map((link) => (
        <div className="nav-item" key={link.label}>
          <NavigationButton {...link} />
        </div>
      ))}
      <div className="nav-item">
        <NavigationButton
          label="更多工作与管理"
          icon={Grid2X2}
          active={more.some((link) => link.active)}
          onClick={() => setOpen(true)}
        />
      </div>
      {open && (
        <Modal title="工作与管理" onClose={() => setOpen(false)}>
          <div className="workspace-more-links">
            {more.map(({ label, icon: Icon, href, active }) => (
              <a
                key={label}
                href={href}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                <Icon size={20} strokeWidth={1.65} />
                <span>{label}</span>
              </a>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
