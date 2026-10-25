import { pendingSurfaceChoice, clearSurfaceChoice } from './surface-choice';
import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from './session';
import { governanceClient } from '../governance/client';
import { useRemote, Loading, Failure } from '../shared/admin';
import { EntryChoice, EntryFrame } from './EntryFrame';
import { Building2, LayoutPanelTop, ShieldCheck, type LucideIcon } from 'lucide-react';
import { requestNavigationLocked } from '../shared/request-guard';
import type { Identity, Membership } from '../../contracts/public-api/identity';

type Surface = 'workspace' | 'tenant-admin' | 'platform-admin';
const labels: Record<Surface, string> = {
  workspace: '客户端',
  'tenant-admin': '企业管理端',
  'platform-admin': '总台端',
};
const details: Record<Surface, string> = {
  workspace: '阅读画报、会话、资料库与技能',
  'tenant-admin': '管理成员、资料权限与企业配置',
  'platform-admin': '平台运营、企业开通与系统设置',
};
const icons: Record<Surface, LucideIcon> = {
  workspace: LayoutPanelTop,
  'tenant-admin': Building2,
  'platform-admin': ShieldCheck,
};
const tones: Record<Surface, 'accent' | 'gold' | 'plain'> = {
  workspace: 'accent',
  'tenant-admin': 'gold',
  'platform-admin': 'plain',
};
function useManagement(identity: Identity | null) {
  return useRemote(
    async (signal) => {
      const members = identity?.memberships.filter((m) => m.service?.status !== 'SUSPENDED') ?? [];
      const results = await Promise.all(
        members.map(async (m) => ({
          membership: m,
          access: await governanceClient.snapshot(m.tenantId, signal),
        })),
      );
      return {
        account: identity?.account.id,
        members: results.filter((r) => r.access.canEnterManagement).map((r) => r.membership),
      };
    },
    [identity],
  );
}
function surfaces(identity: Identity, management: Membership[]): Surface[] {
  return [
    ...(identity.platformAdmin ? ['platform-admin' as const] : []),
    ...(management.length ? ['tenant-admin' as const] : []),
    ...(identity.memberships.length ? ['workspace' as const] : []),
  ];
}

/** Only a newly authenticated unified entrance asks for a surface. Existing tabs keep their location. */
export function SurfaceEntry({ surface, children }: { surface: Surface; children: ReactNode }) {
  const { session } = useSession();
  if (session.phase !== 'authenticated' || !pendingSurfaceChoice() || surface === 'platform-admin')
    return children;
  return (
    <ChooseSurface key={session.identity!.account.id} identity={session.identity!} surface={surface}>
      {children}
    </ChooseSurface>
  );
}
function ChooseSurface({
  identity,
  surface,
  children,
}: {
  identity: Identity;
  surface: Surface;
  children: ReactNode;
}) {
  const data = useManagement(identity);
  const { logout } = useSession();
  const [chosen, setChosen] = useState(false);
  const options = data.value?.account === identity.account.id ? surfaces(identity, data.value.members) : [];
  const choose = (target: Surface) => {
    clearSurfaceChoice();
    if (target === surface) setChosen(true);
    else window.location.assign(`/${target}/`);
  };
  useEffect(() => {
    if (data.value?.account === identity.account.id && options.length <= 1) {
      if (options.length) choose(options[0]);
      else {
        clearSurfaceChoice();
        setChosen(true);
      }
    }
  }, [data.value]);
  if (chosen) return children;
  return (
    <EntryFrame label="选择进入哪一端">
      <h1>选择进入哪一端</h1>
      <p>{identity.account.displayName}，欢迎回来。这次要进入哪里？</p>
      {data.error ? (
        <Failure error={data.error} retry={() => window.location.reload()} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <div className="access-choices">
          {[...options].reverse().map((target) => (
            <EntryChoice
              key={target}
              id={target}
              name={labels[target]}
              detail={details[target]}
              icon={icons[target]}
              tone={tones[target]}
              onClick={() => choose(target)}
            />
          ))}
        </div>
      )}
      <button type="button" className="access-quiet-link" onClick={() => void logout()}>
        退出登录
      </button>
    </EntryFrame>
  );
}

/** Shared admin navigation; never includes enterprises reachable only through support delegation. */
export function SurfaceLinks({ surface, tenant }: { surface: Surface; tenant?: string }) {
  const { session } = useSession();
  const data = useManagement(session.identity);
  if (!session.identity || data.value?.account !== session.identity.account.id) return null;
  const identity = session.identity,
    management = data.value.members;
  const members = surface === 'tenant-admin' ? management : identity.memberships;
  return (
    <div className="admin-customer-links">
      {surface === 'tenant-admin' && members.length > 1 && (
        <label>
          切换企业
          <select
            aria-label="切换企业"
            value={tenant ?? ''}
            onChange={(e) => {
              if (!requestNavigationLocked())
                window.location.assign(`/tenant-admin/#tenant=${encodeURIComponent(e.target.value)}`);
            }}
          >
            {members.map((m) => (
              <option key={m.tenantId} value={m.tenantId}>
                {m.tenantName}
              </option>
            ))}
          </select>
        </label>
      )}
      {surfaces(identity, management)
        .filter((target) => target !== surface)
        .filter(
          (target) => target !== 'tenant-admin' || !tenant || management.some((m) => m.tenantId === tenant),
        )
        .map((target) => (
          <a
            className="button ghost"
            key={target}
            href={`/${target}/${target !== 'platform-admin' && tenant ? `#tenant=${encodeURIComponent(tenant)}` : ''}`}
            onClick={(e) => {
              if (requestNavigationLocked()) e.preventDefault();
            }}
          >
            {labels[target]}
          </a>
        ))}
    </div>
  );
}
