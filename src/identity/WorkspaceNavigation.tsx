import { useNavHover } from '../components/NavIconButton';
import { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { NavigationButton } from '../shared/layout';

export type WorkspaceLink = { label: string; icon: LucideIcon; href: string; active?: boolean; notification?: string };

/** Daily work stays in three direct entries; enterprise tools live with the tenant. */
export function WorkspaceNavigation({ primary, routeKey }: { primary: WorkspaceLink[]; routeKey?: string }) {
  const rail = useRef<HTMLDivElement>(null);
  const { expanded, dismiss, interaction } = useNavHover(rail, routeKey);
  return (
    <div ref={rail} className="workspace-nav-items">
      {primary.map((link) => (
        <div
          className={`nav-item ${expanded === link.label ? 'is-expanded' : ''}`}
          data-nav-hover
          key={link.label}
          {...interaction(link.label)}
        >
          <NavigationButton {...link} onClick={dismiss} />
          {link.notification && <span className="workspace-notification-dot" role="img" aria-label={link.notification} />}
        </div>
      ))}
    </div>
  );
}
