import { useState } from 'react';
import { CirclePause, RefreshCw } from 'lucide-react';
import type { Identity, Membership } from '../../contracts/public-api/identity';
import { DreamcoreLogo } from '../components/DreamcoreLogo';
import { Button } from '../shared/ui';
import { useSession } from './session';
import './service-notice.css';

export function SuspendedEnterprise({
  membership,
  identity,
}: {
  membership: Membership;
  identity: Identity;
}) {
  const { refresh, logout } = useSession();
  const [busy, setBusy] = useState(false);
  const service = membership.service!;
  const others = identity.memberships.filter(
    (m) => m.tenantId !== membership.tenantId && m.service?.status !== 'SUSPENDED',
  );
  return (
    <main className="service-notice-shell">
      <section className="access-panel service-notice" aria-label="企业服务暂停">
        <DreamcoreLogo />
        <CirclePause className="service-notice-icon" size={32} />
        <p className="muted">{membership.tenantName}</p>
        <h1>企业服务已暂停</h1>
        <p className="service-notice-explanation">
          {service.explanation || '本企业暂时无法使用，请联系企业负责人或平台服务人员了解详情。'}
        </p>
        {service.changedAt && (
          <p className="muted">
            暂停于 {new Date(service.changedAt).toLocaleString('zh-CN', { hour12: false })}
          </p>
        )}
        <p className="muted">企业资料和成员关系保留。需要协助时，请联系企业负责人或平台服务人员。</p>
        <Button
          icon={RefreshCw}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void refresh(true).finally(() => setBusy(false));
          }}
        >
          重新检查服务状态
        </Button>
        {!!others.length && (
          <div className="service-notice-others">
            <h2>前往其他企业</h2>
            {others.map((m) => (
              <a
                className="button secondary"
                key={m.tenantId}
                href={'/workspace/#' + new URLSearchParams({ tenant: m.tenantId, view: 'briefing' })}
              >
                {m.tenantName}
              </a>
            ))}
          </div>
        )}
        <Button variant="ghost" onClick={() => void logout()}>
          退出账号
        </Button>
      </section>
    </main>
  );
}
