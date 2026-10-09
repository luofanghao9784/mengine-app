import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 样式全部来自主仓库的产品本身，和登录后的界面是同一套。
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@dreamcore/src/shared/theme.css';
import '@dreamcore/src/identity/access.css';
import '@dreamcore/src/identity/workspace.css';
import '@dreamcore/src/identity/workspace-theme.css';
import '@dreamcore/src/admin/admin-theme.css';
import './login.css';
import { Login } from './Login';
import type { Surface } from './auth';

const root = document.getElementById('root')!;
const surface = (root.dataset.surface ?? 'workspace') as Surface;
// 产品按这个属性切换三个端的主题。
document.documentElement.dataset.surface = { workspace: 'workspace', admin: 'tenant-admin', platform: 'platform-admin' }[surface];
createRoot(root).render(
  <StrictMode>
    <Login surface={surface} />
  </StrictMode>,
);
