import { adminHref } from './navigation';
import { EngineTelemetryWall } from '../operations/EngineTelemetryWall';
import { useSession } from '../identity/session';
import { GeneralExperienceLibrary } from '../experience/GeneralExperienceLibrary';
import { AdminShell, useAdminRoute } from './AdminShell';
import { AdminOverview } from './AdminOverview';
import { PlatformHome } from '../platform/PlatformHome';
import { PlatformAccounts } from '../platform/PlatformAccounts';
import { PlatformSettings } from '../platform/PlatformSettings';
import { OperationsPanel } from '../operations/OperationsPanel';
import { MethodWorkbench } from '../methods/MethodWorkbench';

export function PlatformConsole({ logout }: { logout: () => void }) {
  const { session } = useSession();
  const { page, hash } = useAdminRoute('platform');
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
      ) : page === 'engine' ? (
        <>
          <div className="admin-secondary-link">
            <a href={adminHref('platform', 'usage', hash)}>查看用量与成本</a>
          </div>
          <EngineTelemetryWall scope="platform" />
        </>
      ) : page === 'usage' ? (
        <OperationsPanel scope="platform" />
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
