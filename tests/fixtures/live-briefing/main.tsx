import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionProvider } from '../../../src/identity/session';
import { RequestGuard } from '../../../src/shared/request-guard';
import { PageActionsContext } from '../../../src/shared/ui';
import { LiveBriefing } from '../../../src/briefing-live/Briefing';
import '../../../src/styles.css';
import '../../../src/identity/access.css';
function Fixture() {
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  return (
    <SessionProvider>
      <RequestGuard>
        <PageActionsContext.Provider value={actions}>
          <header
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 16,
              padding: '12px 24px',
              flexWrap: 'wrap',
            }}
          >
            <strong>智能画报</strong>
            <div ref={setActions} />
            <div className="topbar-meta" />
          </header>
          <main style={{ padding: '20px 24px', maxWidth: 1320, margin: '0 auto' }}>
            <LiveBriefing tenant="00000000-0000-4000-8000-000000000001" />
          </main>
        </PageActionsContext.Provider>
      </RequestGuard>
    </SessionProvider>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
