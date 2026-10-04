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
import { MethodWorkbench } from '../methods/MethodWorkbench';

export function PlatformConsole({ logout }: { logout: () => void }) {
  const { session } = useSession();
  const { page, hash } = useAdminRoute('platform');
  const detail = new URLSearchParams(hash.slice(1)).get('detail');
  return (
    <AdminShell
      realm="platform"
      name="平台管理"
      account={session.identity?.account.displayName || ''}
      page={page}
      hash={hash}
      logout={logout}
    >
      {page === 'overview' ? (
        <AdminOverview realm="platform" hash={hash} />
      ) : page === 'tenants' ? (
        <PlatformHome embedded />
      ) : page === 'accounts' ? (
        <PlatformAccounts />
      ) : page === 'engine' && detail === 'storage' ? (
        <PlatformStorage hash={hash} />
      ) : page === 'engine' && detail === 'data' ? (
        <PlatformDataOperations hash={hash} />
      ) : page === 'engine' ? (
        <>
          <div className="admin-secondary-link">
            <a href={adminHref('platform', 'engine', hash, { detail: 'data' })}>数据运行</a>
            <a href={adminHref('platform', 'engine', hash, { detail: 'storage' })}>存储与备份</a>
            <a href={adminHref('platform', 'usage', hash)}>查看用量与成本</a>
          </div>
          <StorageAlert hash={hash} />
          <EngineTelemetryWall scope="platform" />
        </>
      ) : page === 'usage' ? (
        <PlatformUsagePage hash={hash} />
      ) : page === 'capabilities' ? (
        <MethodWorkbench />
      ) : page === 'settings' ? (
        <PlatformSettings hash={hash} />
      ) : (
        <GeneralExperienceLibrary />
      )}
    </AdminShell>
  );
}
