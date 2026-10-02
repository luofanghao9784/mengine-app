import { useContext } from 'react';
import { Building2, Check, ExternalLink, type LucideIcon } from 'lucide-react';
import type { Membership } from '../../contracts/public-api/identity';
import { RequestPending, requestNavigationLocked } from '../shared/request-guard';
import './account-workspaces.css';

export function AccountWorkspaces({
  tenant,
  memberships,
  links,
  onChoose,
  onNavigate,
}: {
  tenant: string;
  memberships: Membership[];
  links: { label: string; newTabLabel: string; href: string; icon: LucideIcon }[];
  onChoose: (tenant: string) => void;
  onNavigate: () => void;
}) {
  const pending = useContext(RequestPending);
  if (!memberships.length && !links.length) return null;
  return (
    <section className="account-workspaces" aria-label="企业与管理">
      {memberships.length > 0 && (
        <>
          <div className="account-workspaces-heading">
            <h3>我的企业</h3>
            {memberships.length > 1 && <span>选择以切换</span>}
          </div>
          <div className="account-workspace-list">
            {memberships.map((membership) => (
              <button
                type="button"
                key={membership.tenantId}
                className={`account-workspace-option ${membership.tenantId === tenant ? 'is-current' : ''}`}
                aria-pressed={membership.tenantId === tenant}
                disabled={pending}
                onClick={() => {
                  if (!requestNavigationLocked() && membership.tenantId !== tenant)
                    onChoose(membership.tenantId);
                }}
              >
                <Building2 size={18} aria-hidden="true" />
                <span>{membership.tenantName}</span>
                {membership.tenantId === tenant && (
                  <>
                    <small>当前企业</small>
                    <Check size={16} aria-hidden="true" />
                  </>
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {!!links.length && (
        <div className="account-management-links" inert={pending || undefined}>
          {links.map(({ label, newTabLabel, href, icon: Icon }) => (
            <div className="account-management-link" key={label}>
              <a
                href={href}
                onClick={(event) => {
                  if (requestNavigationLocked()) {
                    event.preventDefault();
                    return;
                  }
                  onNavigate();
                }}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
              </a>
              <a
                className="account-management-new-tab"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={newTabLabel}
                title={newTabLabel}
                onClick={(event) => {
                  if (requestNavigationLocked()) event.preventDefault();
                  else onNavigate();
                }}
              >
                <ExternalLink size={16} aria-hidden="true" />
              </a>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
