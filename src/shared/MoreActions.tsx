import { useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { IconButton } from './ui';
import { ActionPopover } from './ActionPopover';
import { requestNavigationLocked } from './request-guard';

export function MoreActions({ label = '更多操作', children }: { label?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div ref={ref} className="workspace-more-actions">
      <IconButton icon={MoreHorizontal} label={label} aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <ActionPopover
          anchor={ref}
          label={label}
          onClose={() => {
            if (!requestNavigationLocked()) setOpen(false);
          }}
        >
          <div
            className="workspace-action-list"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button, a') && !requestNavigationLocked())
                setOpen(false);
            }}
          >
            {children}
          </div>
        </ActionPopover>
      )}
    </div>
  );
}
