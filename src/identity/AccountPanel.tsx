import { useContext, useState, useRef } from 'react';
import { ArrowLeft, Building2, ChevronRight, ExternalLink, LogOut, Settings, UserRound } from 'lucide-react';
import type { Identity, Membership } from '../../contracts/public-api/identity';
import { Modal, Button } from '../shared/ui';
import { RequestPending, requestNavigationLocked } from '../shared/request-guard';
import { useRemote } from '../shared/admin';
import { Profiles } from '../profile/Profiles';
import { contactLabel } from './client';
import { PhoneAuth, ChangePassword } from './PhoneAuth';
import { phoneClient } from './phone-client';
import { ConversationTrash } from '../conversation/ConversationTrash';
import './account-panel.css';

type Page = 'quick' | 'account' | 'profiles' | 'companies' | 'password' | 'invite' | 'trash';
export function AccountPanel({
  identity,
  tenant,
  memberships,
  links,
  onChoose,
  onClose,
  onLogout,
}: {
  identity: Identity;
  tenant: string;
  memberships: Membership[];
  links: { label: string; href: string }[];
  onChoose: (id: string) => void;
  onClose: () => void;
  onLogout: () => Promise<void>;
}) {
  const content = useRef<HTMLElement>(null);
  const [dirty, setDirty] = useState(false);
  const mayLeave = () =>
    !dirty || !content.current?.querySelector('form') || window.confirm('还有未保存的内容，确定离开吗？');
  const [page, setPage] = useState<Page>('quick');
  const [companiesOpen, setCompaniesOpen] = useState(false);
  const [joined, setJoined] = useState<Membership>();
  const [error, setError] = useState('');
  const pending = useContext(RequestPending);
  const current = identity.memberships.find((m) => m.tenantId === tenant);
  const settings = page !== 'quick';
  const navigate = (next: Page) => {
    if (!requestNavigationLocked() && mayLeave()) {
      setDirty(false);
      setPage(next);
    }
  };
  const close = () => {
    if (!requestNavigationLocked() && mayLeave()) onClose();
  };
  const choose = (id: string) => {
    if (!requestNavigationLocked() && mayLeave()) {
      onChoose(id);
      onClose();
    }
  };
  const companies = (
    <div className="account-company-list">
      {memberships.map((m) => (
        <button
          key={m.tenantId}
          disabled={pending || m.tenantId === tenant}
          onClick={() => choose(m.tenantId)}
        >
          <Building2 size={17} />
          <span>{m.tenantName}</span>
          {m.tenantId === tenant && <small>当前企业 ✓</small>}
        </button>
      ))}
    </div>
  );
  return (
    <Modal
      title={settings ? '个人设置' : '我的账号'}
      onClose={close}
      className={settings ? 'account-settings' : 'account-quick'}
      wide={settings}
    >
      {!settings ? (
        <>
          <div className="account-identity">
            <UserRound size={30} />
            <div>
              <strong>{identity.account.displayName}</strong>
              <p>{contactLabel(identity.account)}</p>
            </div>
          </div>
          <div className="account-menu">
            {current &&
              (memberships.length > 1 ? (
                <button aria-expanded={companiesOpen} onClick={() => setCompaniesOpen(!companiesOpen)}>
                  <Building2 size={18} />
                  <span>当前企业</span>
                  <small>{current.tenantName}</small>
                  <ChevronRight size={16} />
                </button>
              ) : (
                <div className="account-current">
                  <Building2 size={18} />
                  <span>当前企业</span>
                  <small>{current.tenantName}</small>
                </div>
              ))}
            {companiesOpen && companies}
            <button onClick={() => navigate('account')}>
              <Settings size={18} />
              <span>个人设置</span>
              <ChevronRight size={16} />
            </button>
          </div>
          {!!links.length && (
            <div className="account-menu">
              {links.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    if (requestNavigationLocked()) e.preventDefault();
                    else onClose();
                  }}
                >
                  <Building2 size={18} />
                  <span>{link.label}</span>
                  <ExternalLink size={16} />
                </a>
              ))}
            </div>
          )}
          <div className="account-menu">
            <button
              disabled={pending}
              onClick={() => {
                void onLogout().catch(() => setError('退出未完成，请重试。'));
              }}
            >
              <LogOut size={18} />
              <span>退出登录</span>
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </>
      ) : (
        <>
          <button
            className="account-back"
            disabled={pending}
            onClick={() =>
              navigate(page === 'password' ? 'account' : page === 'invite' ? 'companies' : 'quick')
            }
          >
            <ArrowLeft size={16} />
            返回{page === 'password' ? '账号与安全' : page === 'invite' ? '企业与邀请' : '快捷菜单'}
          </button>
          <div className="account-settings-layout">
            <nav aria-label="个人设置分类">
              {(
                [
                  ['account', '账号与安全'],
                  ['profiles', 'AI 偏好与个人档案'],
                  ['companies', '企业与邀请'],
                  ['trash', '会话回收站'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  disabled={pending || ((key === 'profiles' || key === 'trash') && !current)}
                  aria-current={
                    page === key ||
                    (key === 'account' && page === 'password') ||
                    (key === 'companies' && page === 'invite')
                      ? 'page'
                      : undefined
                  }
                  onClick={() => navigate(key)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <section
              ref={content}
              className="account-settings-content"
              onChangeCapture={() => setDirty(true)}
            >
              {page === 'account' && (
                <>
                  <h3>账号与安全</h3>
                  <dl>
                    <dt>姓名</dt>
                    <dd>{identity.account.displayName}</dd>
                    <dt>{identity.account.phone ? '登录手机号' : '登录邮箱'}</dt>
                    <dd>{contactLabel(identity.account)}</dd>
                  </dl>
                  <Button onClick={() => navigate('password')}>修改密码</Button>
                </>
              )}
              {page === 'trash' && current && <ConversationTrash tenant={tenant} />}
              {page === 'password' && (
                <>
                  <h3>修改密码</h3>
                  <ChangePassword done={() => setPage('account')} />
                </>
              )}
              {page === 'profiles' && current && (
                <>
                  <p className="muted">适用于：{current.tenantName} · 其他企业独立保存</p>
                  <Profiles tenant={tenant} personalOnly />
                </>
              )}
              {page === 'companies' && (
                <>
                  <h3>企业与邀请</h3>
                  {memberships.length ? companies : <p>尚未加入企业</p>}
                  <Button
                    onClick={() => {
                      setJoined(undefined);
                      navigate('invite');
                    }}
                  >
                    通过邀请加入企业
                  </Button>
                </>
              )}
              {page === 'invite' &&
                (joined ? (
                  <>
                    <h3>已加入 {joined.tenantName}</h3>
                    <div className="row">
                      <Button variant="primary" onClick={() => choose(joined.tenantId)}>
                        进入该企业
                      </Button>
                      <Button onClick={close}>留在当前企业</Button>
                    </div>
                  </>
                ) : (
                  <AccountInvitation
                    identity={identity}
                    onJoined={setJoined}
                    onCancel={() => navigate('companies')}
                  />
                ))}
            </section>
          </div>
        </>
      )}
    </Modal>
  );
}
function AccountInvitation({
  identity,
  onJoined,
  onCancel,
}: {
  identity: Identity;
  onJoined: (m: Membership) => void;
  onCancel: () => void;
}) {
  const config = useRemote((signal) => phoneClient.configuration(signal), []);
  return (
    <PhoneAuth
      token=""
      inviting
      identity={identity}
      legacyAllowed={config.value?.delivery === 'DISABLED'}
      onJoined={onJoined}
      onCancel={onCancel}
      onInvite={() => {}}
    />
  );
}
