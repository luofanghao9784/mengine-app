import { SupportPageRedirect } from '../platform/SupportApp';
import { PlatformDataOperations } from '../operations/PlatformDataOperations';
import { EngineTelemetryWall } from '../operations/EngineTelemetryWall';
import { useSession } from '../identity/session';
import { GeneralExperienceLibrary } from '../experience/GeneralExperienceLibrary';
import { AdminShell, useAdminRoute } from './AdminShell';
import { AdminOverview } from './AdminOverview';
import { PlatformHome } from '../platform/PlatformHome';
import { AccountEnterpriseLink } from '../platform/PlatformAccounts';
import { PlatformSettings } from '../platform/PlatformSettings';
import { PlatformUsagePage } from '../operations/UsagePanel';
import { PlatformEngineManagement } from './PlatformEngineManagement';

export function PlatformConsole({ logout }: { logout: () => void }) {
  const { session } = useSession();
  const { page, hash } = useAdminRoute('platform');
  const params = new URLSearchParams(hash.slice(1));
  if (params.get('support') && params.get('tenant'))
    return <SupportPageRedirect />;
  const enterprisePage = page === 'tenants' || page === 'accounts';
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
      ) : enterprisePage ? (
        params.has('account') && !params.has('enterprise') ? (
          <AccountEnterpriseLink id={params.get('account')!} />
        ) : (
          <PlatformHome embedded />
        )
      ) : page === 'database' || page === 'materials' ? (
        <PlatformDataOperations hash={hash} kind={page === 'materials' ? 'MATERIALS' : 'CONNECTIONS'} />
      ) : page === 'engine' ? (
        <EngineTelemetryWall scope="platform" />
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
