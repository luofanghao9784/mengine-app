import { useEffect, useState } from 'react';
import { TenantConsole } from '../TenantConsole';
import { AccessWork } from './AccessWork';
import { useSession } from '../../identity/session';
import { requestNavigationLocked } from '../../shared/request-guard';
import './business-work.css';

const pages = { experience: 'experience', company: 'company', usage: 'usage', members: 'members' } as const;
export function BusinessWork({ tenant, place }: { tenant: string; place: keyof typeof pages }) {
  const { session } = useSession();
  const [access, setAccess] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('admin') !== pages[place]) {
      p.set('admin', pages[place]);
      p.delete('detail');
      p.delete('tab');
      p.delete('member');
    }
    p.set('tenant', tenant);
    location.hash = p.toString();
    setReady(true);
  }, [tenant, place]);
  const name = session.identity?.memberships.find((m) => m.tenantId === tenant)?.tenantName || '企业管理';
  return (
    <section
      className="cards glass business-work"
      aria-label={place === 'members' ? '成员与权限' : '业务管理'}
    >
      <article className="card">
        {place === 'members' && (
          <nav className="business-tabs" aria-label="成员权限管理范围">
            <button
              aria-pressed={access}
              onClick={() => {
                if (!requestNavigationLocked()) setAccess(true);
              }}
            >
              数据权限与部门
            </button>
            <button
              aria-pressed={!access}
              onClick={() => {
                if (!requestNavigationLocked()) setAccess(false);
              }}
            >
              账号、空间与职责交接
            </button>
          </nav>
        )}
        {place === 'members' && <p role="note">先邀请成员加入企业，再在共享空间中授予只读或维护权限。数据资源权限独立核对；加入企业不代表可以读取所有内容。</p>}
        {access && place === 'members' ? (
          <AccessWork />
        ) : (
          ready && <TenantConsole tenant={tenant} name={name} embedded />
        )}
      </article>
    </section>
  );
}
export function OutputWork({ tenant }: { tenant: string }) {
  const links: [string, string, string][] = [
    ['智能画报', 'briefing', '查看本人获权的画报与依据，继续讨论或生成'],
    ['会话回复', 'conversations', '继续本人会话，查看执行状态与回复'],
    ['成果文件', 'documents', '查看本人生成的文稿、版本及保存记录'],
  ];
  return (
    <section className="cards glass business-work" aria-label="输出">
      <article className="card">
        <header>
          <h2>输出与成果</h2>
        </header>
        <p>按当前账号与工作空间权限打开成果。企业管理身份不会公开其他员工的私人会话。</p>
        <div className="output-links">
          {links.map(([name, view, description]) => (
            <a
              key={view}
              target="_top"
              href={`/workspace/#tenant=${encodeURIComponent(tenant)}&view=${view}`}
            >
              <h3>{name}</h3>
              <p>{description}</p>
              <span>打开 →</span>
            </a>
          ))}
        </div>
      </article>
    </section>
  );
}
