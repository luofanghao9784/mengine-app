import { requestSurfaceChoice } from './surface-choice';
import { useRequestLock } from '../shared/request-guard';
import { useEffect, useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { Identity, Membership } from '../../contracts/public-api/identity';
import { Button, Field } from '../shared/ui';
import { IdentityError, contactLabel } from './client';
import { identityClient, useSession } from './session';
import { phoneClient } from './phone-client';
import type { Challenge, InvitationPreview } from './phone-client';

const errorText = (error: unknown) =>
  error instanceof IdentityError ? error.message : '请求未完成，请稍后重试。';
function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <p className="access-alert" role="alert">
      {error}
    </p>
  ) : null;
}

export function PasswordField({
  value,
  change,
  label = '密码',
  creating = false,
  action,
}: {
  value: string;
  change: (v: string) => void;
  label?: string;
  creating?: boolean;
  /** A link beside the label, such as “忘记密码”; kept outside the label so it does not focus the input. */
  action?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const control = (
    <div className="phone-password">
      <input
        id={id}
        aria-label={label}
        type={visible ? 'text' : 'password'}
        name={creating ? 'new-password' : 'password'}
        autoComplete={creating ? 'new-password' : 'current-password'}
        minLength={creating ? 6 : undefined}
        maxLength={128}
        required
        value={value}
        onChange={(e) => change(e.target.value)}
      />
      <button
        type="button"
        aria-label={visible ? '隐藏密码' : '显示密码'}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
      >
        {visible ? <EyeOff size={18} strokeWidth={1.7} /> : <Eye size={18} strokeWidth={1.7} />}
      </button>
    </div>
  );
  if (!action)
    return (
      <Field label={label} hint={creating ? '至少 6 位，可使用更长密码。' : undefined}>
        {control}
      </Field>
    );
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      {control}
    </div>
  );
}
function PhoneField({ value, change }: { value: string; change: (v: string) => void }) {
  return (
    <Field label="手机号">
      <input
        type="tel"
        name="phone"
        inputMode="tel"
        autoComplete="tel"
        placeholder="手机号，海外号码请带国家区号"
        maxLength={40}
        required
        value={value}
        onChange={(e) => change(e.target.value)}
      />
    </Field>
  );
}
export function CodeField({
  purpose,
  issue,
  phone,
  token,
  challenge,
  setChallenge,
  code,
  setCode,
}: {
  purpose: 'JOIN' | 'BIND' | 'RESET';
  issue?: () => Promise<Challenge>;
  phone?: string;
  token?: string;
  challenge: Challenge | null;
  setChallenge: (v: Challenge | null) => void;
  code: string;
  setCode: (v: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [until, setUntil] = useState(0),
    [now, setNow] = useState(Date.now());
  const [localCode, setLocalCode] = useState('');
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setChallenge(null);
    setCode('');
    setLocalCode('');
    setError('');
  }, [phone, token, purpose]);
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <>
      <Field label="短信验证码">
        <div className="phone-code">
          <input
            aria-label="短信验证码"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button
            disabled={busy || seconds > 0 || (purpose !== 'JOIN' && !phone?.trim())}
            onClick={async () => {
              setBusy(true);
              setError('');
              setLocalCode('');
              try {
                const next = await (issue ? issue() : phoneClient.challenge(purpose, phone, token));
                setChallenge(next);
                setCode('');
                setUntil(Date.now() + next.retryAfterSeconds * 1000);
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '获取中…' : seconds ? `${seconds} 秒后重试` : '获取验证码'}
          </Button>
        </div>
      </Field>
      {challenge && (
        <p className="phone-local-note">
          本地测试短信，未发送至手机。
          {challenge.localPreview && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const result = await phoneClient.localCode(challenge.id);
                  setLocalCode(result.code);
                  setError('');
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              查看本地测试短信
            </button>
          )}
          {localCode && (
            <span role="status">
              测试验证码：<strong>{localCode}</strong>
            </span>
          )}
        </p>
      )}
      <ErrorMessage error={error} />
    </>
  );
}

export function PhoneAuth({
  token,
  inviting,
  identity,
  legacyAllowed = false,
  legacyEntry = false,
  welcome = '欢迎回来，登录后继续你的工作。',
  onJoined,
  onCancel,
  onInvite,
}: {
  token: string;
  inviting: boolean;
  identity: Identity | null;
  legacyAllowed?: boolean;
  /** Only the platform console still offers the original email-account path. */
  legacyEntry?: boolean;
  welcome?: string;
  onJoined: (m: Membership) => void;
  onCancel: () => void;
  onInvite: () => void;
}) {
  const { authenticated, login, logout, expire } = useSession();
  const [mode, setMode] = useState<'login' | 'legacy' | 'reset'>('login');
  const [phone, setPhone] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState('');
  const [code, setCode] = useState(''),
    [challenge, setChallenge] = useState<Challenge | null>(null);
  const [previewState, setPreview] = useState<{ context: string; value: InvitationPreview } | null>(null),
    [previewError, setPreviewError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [inviteInput, setInviteInput] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const [manualToken, setManualToken] = useState('');
  const effectiveToken = token || manualToken || undefined;
  const previewKey = `${identity?.account.id || 'anonymous'}:${identity?.account.phone || ''}:${effectiveToken || 'stored'}:${attempt}`;
  const preview = previewState?.context === previewKey ? previewState.value : null;
  const binding = !!identity && !identity.account.phone;
  const legacyPlatform = binding && identity.account.email?.endsWith('@identity.invalid');
  const [unifiedPassword, setUnifiedPassword] = useState('');
  useEffect(() => {
    let active = true;
    setPreview(null);
    setPreviewError('');
    setCode('');
    setChallenge(null);
    setError('');
    if (inviting)
      phoneClient
        .preview(effectiveToken)
        .then((v) => {
          if (active) setPreview({ context: previewKey, value: v });
        })
        .catch((e) => {
          if (active) setPreviewError(errorText(e));
        });
    return () => {
      active = false;
    };
  }, [inviting, effectiveToken, identity?.account.id, identity?.account.phone, attempt]);
  const switchMode = (value: typeof mode) => {
    setMode(value);
    setPassword('');
    setError('');
    setNotice('');
    setCode('');
    setChallenge(null);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (binding) {
        if (!challenge) throw new Error('verification required');
        const identity = await phoneClient.bind({
          phone,
          password,
          unifiedPassword: legacyPlatform ? unifiedPassword : undefined,
          challengeId: challenge.id,
          code,
        });
        setPassword('');
        authenticated(identity);
        setMode('login');
      } else if (mode === 'legacy') {
        const identity = await identityClient.legacyLogin(email.trim(), password);
        setPassword('');
        authenticated(identity);
        requestSurfaceChoice();
        setMode('login');
      } else if (mode === 'reset') {
        if (!challenge) throw new Error('verification required');
        await phoneClient.reset({ phone, password, challengeId: challenge.id, code });
        expire();
        setPassword('');
        setMode('login');
        setNotice('密码已更新，请使用手机号和新密码登录。');
      } else if (inviting && preview) {
        const result = await phoneClient.accept({
          requestId,
          token: effectiveToken,
          displayName: preview.action === 'CREATE' ? name.trim() : undefined,
          password: preview.action === 'CONFIRM' ? undefined : password,
          challengeId: challenge?.id,
          code: challenge ? code : undefined,
          acceptResponsibility: preview.designatedOwner,
        });
        setPassword('');
        authenticated(result.identity);
        if (preview.designatedOwner)
          window.location.assign(`/tenant-admin/#tenant=${encodeURIComponent(result.membership.tenantId)}`);
        else onJoined(result.membership);
      } else {
        await login(phone.trim(), password);
        setPassword('');
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  useRequestLock(busy);
  if (inviting && !binding && mode === 'login' && !preview)
    return (
      <>
        <h1>加入企业</h1>
        {previewError ? (
          <>
            <ErrorMessage error={previewError} />
            <Button onClick={() => setAttempt((v) => v + 1)}>重新读取邀请</Button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const value = inviteInput.trim();
                try {
                  const url = new URL(value, location.href);
                  setManualToken(new URLSearchParams(url.hash.slice(1)).get('invite') || value);
                } catch {
                  setManualToken(value);
                }
                setAttempt((v) => v + 1);
              }}
            >
              <Field label="邀请链接或邀请码">
                <input
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value)}
                  required
                  autoComplete="off"
                />
              </Field>
              <Button type="submit">继续</Button>
            </form>
          </>
        ) : (
          <p role="status">正在读取邀请…</p>
        )}
        <Button variant="ghost" onClick={onCancel}>
          返回登录
        </Button>
      </>
    );
  const joining = inviting && mode === 'login' && !binding && preview;
  const creating = !!joining && preview.action === 'CREATE';
  const switching = !!joining && preview.action === 'SWITCH';
  const confirming = !!joining && preview.action === 'CONFIRM';
  return (
    <>
      <h1>
        {binding
          ? '绑定手机号'
          : mode === 'legacy'
            ? legacyAllowed
              ? '原账号登录'
              : '迁移原邮箱账号'
            : mode === 'reset'
              ? '找回密码'
              : joining
                ? `加入${preview.tenantName}`
                : '登录梦擎工作空间'}
      </h1>
      <p className="muted">
        {binding
          ? '验证手机号后继续使用原账号，企业、权限和资料都会保留。'
          : mode === 'legacy'
            ? '先验证原邮箱账号，再绑定手机号。'
            : mode === 'reset'
              ? '验证手机号后设置新密码。'
              : joining
                ? `受邀手机号：${preview.maskedPhone}`
                : welcome}
      </p>
      {legacyEntry && legacyAllowed && !inviting && (
        <p className="muted">
          短信验证暂未启用，原账号可继续使用邮箱和密码登录。手机号绑定将在短信开通后完成。
        </p>
      )}
      {notice && (
        <p className="access-success" role="status">
          {notice}
        </p>
      )}
      {switching ? (
        <>
          <p>当前登录账号 {contactLabel(identity!.account)} 与邀请不匹配。</p>
          <Button
            onClick={async () => {
              try {
                await phoneClient.switchAccount(effectiveToken);
                expire();
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            切换到受邀账号
          </Button>
          <ErrorMessage error={error} />
        </>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            {mode === 'legacy' && !binding ? (
              <Field label="原账号邮箱">
                <input
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            ) : (
              !joining &&
              (mode === 'login' && !binding ? (
                <Field label="用户名或手机号">
                  <input
                    autoComplete="username"
                    required
                    maxLength={40}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="请输入用户名或手机号"
                  />
                </Field>
              ) : (
                <PhoneField value={phone} change={setPhone} />
              ))
            )}
            {creating && (
              <Field label="你的姓名">
                <input
                  name="displayName"
                  autoComplete="name"
                  maxLength={80}
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            )}
            {(creating || binding || mode === 'reset') && (
              <CodeField
                purpose={binding ? 'BIND' : mode === 'reset' ? 'RESET' : 'JOIN'}
                phone={joining ? preview.phone : phone}
                token={effectiveToken}
                challenge={challenge}
                setChallenge={setChallenge}
                code={code}
                setCode={setCode}
              />
            )}
            {!confirming && (
              <PasswordField
                value={password}
                change={setPassword}
                action={
                  mode === 'login' && !binding && !creating ? (
                    <button type="button" className="field-link" onClick={() => switchMode('reset')}>
                      忘记密码
                    </button>
                  ) : undefined
                }
                label={
                  binding
                    ? legacyPlatform
                      ? '总台专用密码'
                      : '原账号密码'
                    : creating || mode === 'reset'
                      ? '设置密码'
                      : '密码'
                }
                creating={creating || mode === 'reset'}
              />
            )}
            {legacyPlatform && (
              <PasswordField
                value={unifiedPassword}
                change={setUnifiedPassword}
                label="设置统一登录密码"
                creating
              />
            )}
            {joining && preview.designatedOwner && (
              <p>接受后，你将成为该企业的初始负责人，并开通企业。资料访问仍按空间授权。</p>
            )}
            <ErrorMessage error={error} />
            <Button
              type="submit"
              variant="primary"
              className="full"
              disabled={(creating || binding || mode === 'reset') && !challenge}
            >
              {busy
                ? '正在处理…'
                : joining && preview.designatedOwner
                  ? '接受并开通企业'
                  : binding
                    ? '绑定并继续'
                    : mode === 'legacy'
                      ? legacyAllowed
                        ? '登录原账号'
                        : '验证原账号'
                      : mode === 'reset'
                        ? '重置密码'
                        : creating
                          ? '加入并开始使用'
                          : confirming
                            ? preview.status === 'ACCEPTED'
                              ? '进入企业'
                              : '确认加入'
                            : joining
                              ? '登录并加入'
                              : '登录'}
            </Button>
          </fieldset>
        </form>
      )}
      <div className="access-auth-links">
        {binding ? (
          <Button variant="ghost" onClick={() => void logout().catch((e) => setError(errorText(e)))}>
            退出账号
          </Button>
        ) : (
          <>
            {mode !== 'login' ? (
              <Button variant="ghost" onClick={() => switchMode('login')}>
                返回{inviting ? '邀请' : '登录'}
              </Button>
            ) : (
              <>
                {legacyEntry && !identity && (
                  <Button variant="ghost" onClick={() => switchMode('legacy')}>
                    {legacyAllowed ? '原邮箱账号登录' : '原邮箱账号迁移'}
                  </Button>
                )}
                {inviting ? (
                  <Button variant="ghost" onClick={onCancel}>
                    暂不加入
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={onInvite}>
                    使用邀请加入企业
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

export function ChangePassword({ done }: { done: () => void }) {
  const { expire } = useSession();
  const [current, setCurrent] = useState(''),
    [next, setNext] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useRequestLock(busy);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          await phoneClient.password(current, next);
          expire();
          done();
        } catch (e) {
          setError(errorText(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <PasswordField label="当前密码" value={current} change={setCurrent} />
        <PasswordField label="新密码" value={next} change={setNext} creating />
        <p className="muted">修改后需使用新密码重新登录。</p>
        <ErrorMessage error={error} />
        <Button type="submit" variant="primary">
          {busy ? '正在修改…' : '修改密码'}
        </Button>
      </fieldset>
    </form>
  );
}
