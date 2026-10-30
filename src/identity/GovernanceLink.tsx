import { useEffect } from 'react';

/** Mounted only by the authenticated management interface, outside entry flows. */
export function GovernanceLink() {
  useEffect(() => {
    const link = document.querySelector<HTMLElement>('[data-governance-link]');
    if (!link) return;
    link.hidden = false;
    return () => {
      link.hidden = true;
    };
  }, []);
  return null;
}
