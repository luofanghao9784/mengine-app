import { AgentAdminAccess } from './AgentAdminAccess';
import { SurfaceEntry } from './SurfaceAccess';
import '../shared/gesture-boundaries.css';
import { createRoot } from 'react-dom/client';
import { SessionProvider } from './session';
import { SupportApp } from '../platform/SupportApp';
import { PlatformApp } from '../platform/PlatformApp';
import AccessApp, { readInvitation, type Surface } from './AccessApp';
// Self-hosted numerals for the D′ admin surfaces and engine dashboard (SIL OFL); browsers fetch only used faces.
import '@fontsource/cormorant-garamond/latin-300.css';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-400-italic.css';
import '../shared/theme.css';
import './access.css';
import './workspace.css';
import './workspace-theme.css';
import '../admin/admin-theme.css';

const root = document.getElementById('root')!;
const surface = root.dataset.surface as Surface | 'headquarters-support' | 'agent-admin';
if (!['agent-admin', 'workspace', 'tenant-admin', 'platform-admin', 'headquarters-support'].includes(surface))
  throw new Error('Unknown entry');
// Surface themes (DEC-130) key off the document root so portals and dialogs inherit them.
document.documentElement.dataset.surface = surface;
const invitation =
  surface === 'agent-admin' || surface === 'platform-admin' || surface === 'headquarters-support'
    ? { token: '', inviting: false }
    : readInvitation();
createRoot(root).render(
  <SessionProvider
    realm={
      surface === 'agent-admin'
        ? 'agent'
        : surface === 'platform-admin' || surface === 'headquarters-support'
          ? 'platform'
          : 'customer'
    }
  >
    {surface === 'agent-admin' ? (
      <AgentAdminAccess />
    ) : surface === 'headquarters-support' ? (
      <SupportApp />
    ) : surface === 'platform-admin' ? (
      <PlatformApp />
    ) : (
      <SurfaceEntry surface={surface}>
        <AccessApp surface={surface} initialInvitation={invitation} />
      </SurfaceEntry>
    )}
  </SessionProvider>,
);
