import { BookOpen } from 'lucide-react';
import { useSession } from '../identity/session';
import { Empty } from '../shared/ui';
import { AdminShell, useAdminRoute } from './AdminShell';
import { AdminOverview } from './AdminOverview';
import { PlatformHome } from '../platform/PlatformHome';
import { PlatformAccounts } from '../platform/PlatformAccounts';
import { PlatformStaffList } from '../platform/PlatformStaff';
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
      ) : page === 'engine' || page === 'usage' ? (
        <OperationsPanel scope="platform" />
      ) : page === 'capabilities' ? (
        <MethodWorkbench />
      ) : page === 'settings' ? (
        <PlatformStaffList />
      ) : (
        <section className="admin-section">
          <Empty
            icon={BookOpen}
            title="通用经验库尚未启用"
            text="启用后，这里展示经过自动脱敏、提炼和核验的通用经验。企业原始会话与资料不会在此展示。"
          />
        </section>
      )}
    </AdminShell>
  );
}
