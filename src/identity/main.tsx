import '../shared/gesture-boundaries.css';
import { createRoot } from 'react-dom/client';
import { SessionProvider } from './session';
import { SupportApp } from '../platform/SupportApp';
import { PlatformApp } from '../platform/PlatformApp';
import AccessApp, { readInvitation, type Surface } from './AccessApp';
import '../shared/theme.css';
import './access.css';
import './workspace.css';
import './workspace-theme.css';
import '../admin/admin-theme.css';

const root = document.getElementById('root')!;
const surface = root.dataset.surface as Surface | 'headquarters-support';
if (!['workspace', 'tenant-admin', 'platform-admin', 'headquarters-support'].includes(surface))
  throw new Error('Unknown entry');
// Surface themes (DEC-130) key off the document root so portals and dialogs inherit them.
document.documentElement.dataset.surface = surface;
const invitation =
  surface === 'platform-admin' || surface === 'headquarters-support'
    ? { token: '', inviting: false }
    : readInvitation();
createRoot(root).render(
  <SessionProvider
    realm={surface === 'platform-admin' || surface === 'headquarters-support' ? 'platform' : 'customer'}
  >
    {surface === 'headquarters-support' ? (
      <SupportApp />
    ) : surface === 'platform-admin' ? (
      <PlatformApp />
    ) : (
      <AccessApp surface={surface} initialInvitation={invitation} />
    )}
  </SessionProvider>,
);
