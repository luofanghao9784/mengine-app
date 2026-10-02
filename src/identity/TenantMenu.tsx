import { useContext, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ExternalLink } from 'lucide-react';
import type { Membership } from '../../contracts/public-api/identity';
import { ActionPopover } from '../shared/ActionPopover';
import { RequestPending, requestNavigationLocked } from '../shared/request-guard';
import type { WorkspaceLink } from './WorkspaceNavigation';
import './tenant-menu.css';

export function TenantMenu({
  tenant,
  memberships,
  links,
  routeKey,
  onChoose,
}: {
  tenant: string;
  memberships: Membership[];
  links: Array<WorkspaceLink & { newTabLabel: string }>;
  routeKey: string;
  onChoose: (tenant: string) => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const pending = useContext(RequestPending);
  const [open, setOpen] = useState(false);
  const current = memberships.find((m) => m.tenantId === tenant);
  const canOpen = memberships.length > 1 || !current || links.length > 0;
  useEffect(() => setOpen(false), [routeKey]);
  if (!canOpen)
    return (
      <span className="access-tenant-name" aria-label="当前企业">
        {current?.tenantName}
      </span>
    );
  return (
    <div ref={anchor} className="tenant-menu">
      <button
        className="tenant-menu-trigger"
        type="button"
        aria-label={`当前企业：${current?.tenantName || '请选择企业'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen(!open)}
      >
        <span>{current?.tenantName || '请选择企业'}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <ActionPopover
          anchor={anchor}
          label="企业与管理"
          onClose={() => {
            if (!requestNavigationLocked()) setOpen(false);
          }}
        >
          <div className="workspace-action-list tenant-menu-items" inert={pending || undefined}>
            {(memberships.length > 1 || !current) && (
              <>
                <p>切换企业</p>
                {memberships.map((membership) => (
                  <button
                    type="button"
                    className="button"
                    key={membership.tenantId}
                    aria-pressed={membership.tenantId === tenant}
                    onClick={() => {
                      if (requestNavigationLocked()) return;
                      setOpen(false);
                      if (membership.tenantId !== tenant) onChoose(membership.tenantId);
                    }}
                  >
                    <span>{membership.tenantName}</span>
                    {membership.tenantId === tenant && <Check size={16} aria-hidden="true" />}
                  </button>
                ))}
              </>
            )}
            {links.map(({ label, newTabLabel, href, icon: Icon }) => (
              <div className="tenant-surface-links" key={label}>
                <a href={href} onClick={() => setOpen(false)}>
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                </a>
                <a
                  className="tenant-open-new"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={newTabLabel}
                  title={newTabLabel}
                  onClick={() => setOpen(false)}
                >
                  <ExternalLink size={18} aria-hidden="true" />
                </a>
              </div>
            ))}
          </div>
        </ActionPopover>
      )}
    </div>
  );
}
