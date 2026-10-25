import { useEffect, useState } from 'react';
import { TenantConsole } from '../TenantConsole';
import { WorkRoles } from './WorkRoles';
import { AccessWork } from './AccessWork';
import { useSession } from '../../identity/session';
import { requestNavigationLocked } from '../../shared/request-guard';
import './business-work.css';

const pages = { experience: 'experience', company: 'company', usage: 'usage', members: 'members' } as const;
export function BusinessWork({ tenant, place }: { tenant: string; place: keyof typeof pages }) {
  const { session } = useSession();
  const [access, setAccess] = useState(false);
  const [roles, setRoles] = useState(false);
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
    // 只是补上旧版管理台要的参数，不算一次切换：替换当前记录，免得浏览器后退停在原地。
    history.replaceState(history.state, '', '#' + p);
    setReady(true);
  }, [tenant, place]);
  const name = session.identity?.memberships.find((m) => m.tenantId === tenant)?.tenantName || '企业管理';
  const managed = place === 'members' || place === 'company';
  const sections = [
    { id: 'people', name: '成员与协作', note: '企业成员、邀请、共享空间与交接' },
    { id: 'access', name: '数据访问', note: '资源授权、审批、部门与操作审计' },
    { id: 'roles', name: '岗位与关注', note: '工作职责、背景与 AI 内容重点' },
  ];
  const active = roles ? 'roles' : access ? 'access' : 'people';
  return (
    <section className={`cards glass business-work${managed ? ' management-work' : ''} ${place}-work`}
      aria-label={place === 'members' ? '成员与权限' : '业务管理'}>
      {place === 'members' && <aside className="card management-nav">
        <header><h2>成员与权限</h2><p>管理人员协作与数据访问</p></header>
        <nav aria-label="成员权限管理范围">{sections.map(item =>
          <button key={item.id} type="button" aria-pressed={active === item.id} onClick={() => {
            if (requestNavigationLocked()) return;
            setRoles(item.id === 'roles'); setAccess(item.id === 'access');
          }}><strong>{item.name}</strong><span>{item.note}</span></button>
        )}</nav>
        <p className="management-note">加入企业、空间协作和数据读取分别授权。</p>
      </aside>}
      <article className="card management-content">
        {place === 'members' && <header className="management-heading">
          <h2>{sections.find(item => item.id === active)?.name}</h2>
          <p>{sections.find(item => item.id === active)?.note}</p>
        </header>}
        {roles && place === 'members' ? <WorkRoles key={tenant} tenant={tenant} />
          : access && place === 'members' ? <AccessWork />
          : ready && <TenantConsole tenant={tenant} name={name} embedded />}
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
