import { PlatformStorage, StorageAlert } from '../operations/PlatformStorage';
import { PlatformDataOperations } from '../operations/PlatformDataOperations';
import { adminHref } from './navigation';
import { EngineTelemetryWall } from '../operations/EngineTelemetryWall';
import { useSession } from '../identity/session';
import { GeneralExperienceLibrary } from '../experience/GeneralExperienceLibrary';
import { AdminShell, useAdminRoute } from './AdminShell';
import { AdminOverview } from './AdminOverview';
import { PlatformHome } from '../platform/PlatformHome';
import { PlatformAccounts } from '../platform/PlatformAccounts';
import { PlatformSettings } from '../platform/PlatformSettings';
import { PlatformUsagePage } from '../operations/UsagePanel';
import { PlatformEngineManagement } from './PlatformEngineManagement';

export function PlatformConsole({ logout }: { logout: () => void }) {
  const { session } = useSession();
  const { page, hash } = useAdminRoute('platform');
  const params = new URLSearchParams(hash.slice(1));
  const detail = params.get('detail');
  const enterprisePage = page === 'tenants' || page === 'accounts';
  const accounts = page === 'accounts' || params.get('directory') === 'accounts';
  return (
    <AdminShell
      realm="platform"
      name="平台管理"
      account={session.identity?.account.displayName || ''}
      page={page}
      hash={hash}
      logout={logout}
    >
      {enterprisePage && !params.has('enterprise') && (
        <nav className="platform-directory-tabs" aria-label="企业管理分类">
          <a href={adminHref('platform', 'tenants', hash)} aria-current={!accounts ? 'page' : undefined}>企业列表</a>
          <a href={adminHref('platform', 'tenants', hash, { directory: 'accounts' })} aria-current={accounts ? 'page' : undefined}>客户账号</a>
        </nav>
      )}
      {page === 'overview' ? (
        <AdminOverview realm="platform" hash={hash} />
      ) : enterprisePage ? (
        accounts ? <PlatformAccounts /> : <PlatformHome embedded />
      ) : page === 'engine' && detail === 'storage' ? (
        <PlatformStorage hash={hash} />
      ) : page === 'engine' && detail === 'data' ? (
        <PlatformDataOperations hash={hash} />
      ) : page === 'engine' ? (
        <>
          <nav className="platform-runtime-links" aria-label="系统运行次级页面">
            <a href={adminHref('platform', 'engine', hash, { detail: 'data' })}>数据运行</a>
            <a href={adminHref('platform', 'engine', hash, { detail: 'storage' })}>存储与备份</a>
            <a href={adminHref('platform', 'usage', hash)}>查看用量与成本</a>
          </nav>
          <StorageAlert hash={hash} />
          <EngineTelemetryWall scope="platform" />
        </>
      ) : page === 'usage' ? (
        <PlatformUsagePage hash={hash} />
      ) : page === 'capabilities' ? (
        <PlatformEngineManagement hash={hash} />
      ) : page === 'settings' ? (
        <PlatformSettings hash={hash} />
      ) : (
        <GeneralExperienceLibrary />
      )}
    </AdminShell>
  );
}
