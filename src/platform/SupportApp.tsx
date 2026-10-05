import { useEffect } from 'react';
import { useSession } from '../identity/session';
import { supportRoute } from '../identity/support-request';
import { useAdminRoute } from '../admin/AdminShell';
import { RequestGuard } from '../shared/request-guard';
import { Loading } from '../shared/admin';
import { UploadProvider } from '../material/UploadManager';
import { SupportConsole } from './SupportConsole';

/** An independent management entry authenticated only by the platform realm. */
export function SupportApp() {
  const { session, refresh } = useSession();
  useAdminRoute('tenant');
  const access = supportRoute();
  useEffect(() => {
    document.title = '企业管理 · 总部支持 · 梦擎工作空间';
  }, []);
  if (session.phase === 'loading') return <Loading />;
  if (session.phase !== 'authenticated' || !access)
    return (
      <main className="admin-content">
        <p role="alert">
          {session.phase === 'unavailable'
            ? '暂时无法确认总部登录状态。'
            : '总部访问不可用，请从总台企业概览重新进入。'}
        </p>
        {session.phase === 'unavailable' && (
          <button className="button" onClick={() => void refresh()}>
            重试
          </button>
        )}
        <a className="button ghost" href="/platform-admin/#admin=tenants">
          返回总台
        </a>
      </main>
    );
  return (
    <RequestGuard>
      <UploadProvider key={access.id}>
        <SupportConsole id={access.id} tenant={access.tenant} />
      </UploadProvider>
    </RequestGuard>
  );
}

/** Historical support URLs navigate to the separate document instead of embedding management. */
export function SupportPageRedirect() {
  useEffect(() => {
    location.replace(`/tenant-admin/support/${location.hash}`);
  }, []);
  return <Loading />;
}
