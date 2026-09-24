import { createRoot } from 'react-dom/client';
import { SessionProvider } from './session';
import AccessApp, { readInvitation, type Surface } from './AccessApp';
import '../shared/theme.css';
import './access.css';

const root = document.getElementById('root')!;
const surface = root.dataset.surface as Surface;
if (!['workspace', 'tenant-admin', 'platform-admin'].includes(surface)) throw new Error('Unknown entry');
const invitation = readInvitation();
createRoot(root).render(
  <SessionProvider>
    <AccessApp surface={surface} initialInvitation={invitation} />
  </SessionProvider>,
);
