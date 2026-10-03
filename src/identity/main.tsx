import '../shared/gesture-boundaries.css';
import { createRoot } from 'react-dom/client';
import { SessionProvider } from './session';
import { PlatformApp } from '../platform/PlatformApp';
import AccessApp, { readInvitation, type Surface } from './AccessApp';
import '../shared/theme.css';
import './access.css';
import './workspace.css';

const root = document.getElementById('root')!;
const surface = root.dataset.surface as Surface;
if (!['workspace', 'tenant-admin', 'platform-admin'].includes(surface)) throw new Error('Unknown entry');
const invitation = surface === 'platform-admin' ? { token: '', inviting: false } : readInvitation();
createRoot(root).render(
  <SessionProvider realm={surface === 'platform-admin' ? 'platform' : 'customer'}>
    {surface === 'platform-admin' ? <PlatformApp /> : <AccessApp surface={surface} initialInvitation={invitation} />}
  </SessionProvider>,
);
