import { createRoot } from 'react-dom/client';
import '@fontsource/cormorant-garamond/latin-300.css';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-400-italic.css';
import '../../shared/theme.css';
import { SessionProvider, useSession } from '../../identity/session';
import { UploadProvider } from '../../material/UploadManager';
import { RequestGuard } from '../../shared/request-guard';
import { uuid } from '../../identity/client';
import { SceneShell } from './SceneShell';

// 仅用于后台标签页里截图检查：?frames=timer 时用定时器代替 requestAnimationFrame，让舞台在不可见时也出帧。
if (new URLSearchParams(location.search).get('frames') === 'timer') {
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16);
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
}

const tenant = new URLSearchParams(location.search).get('tenant');
function Entry() {
  const { session, refresh } = useSession();
  if (!tenant) return <SceneShell />;
  if (!uuid(tenant)) return <div className="scene-login">企业标识无效</div>;
  if (session.phase !== 'authenticated')
    return (
      <div className="scene-login" role="status">
        {session.phase === 'loading' ? (
          '正在验证登录…'
        ) : (
          <>
            <p>请登录企业管理端后继续。</p>
            <a href="/tenant-admin/">
              返回登录
            </a>
            <button onClick={() => void refresh()}>重试</button>
          </>
        )}
      </div>
    );
  if (!session.identity?.memberships.some((m) => m.tenantId === tenant))
    return <div className="scene-login">没有该企业的访问权限</div>;
  return (
    <RequestGuard>
      <UploadProvider>
        <SceneShell key={tenant} tenant={tenant} />
      </UploadProvider>
    </RequestGuard>
  );
}
createRoot(document.getElementById('root')!).render(
  <SessionProvider>
    <Entry />
  </SessionProvider>,
);
