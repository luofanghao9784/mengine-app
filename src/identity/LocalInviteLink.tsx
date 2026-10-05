import { useEffect, useState } from 'react';
import { createIdentityRequest, IdentityError, record, text } from './client';
import { Button } from '../shared/ui';
import { supportRoute } from './support-request';
const request = createIdentityRequest();
export function LocalInviteLink({
  invitation,
  platform = false,
}: {
  invitation: string;
  platform?: boolean;
}) {
  const support = supportRoute();
  const linkPath = support
    ? `/api/tenant-admin/v1/tenants/${support.tenant}/invitations/${invitation}/local-link`
    : (platform ? '/api/platform-admin/v1/local-invitations/' : '/api/v1/auth/phone/local-invitation/') +
      invitation;
  const [enabled, setEnabled] = useState(false),
    [path, setPath] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    request(
      platform
        ? '/api/platform-admin/v1/local-invitations/configuration'
        : '/api/v1/auth/phone/configuration',
      'GET',
      (v): v is { localPreview: boolean } => record(v) && typeof v.localPreview === 'boolean',
    )
      .then((v) => {
        if (active) setEnabled(v.localPreview);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [platform]);
  if (!enabled) return null;
  return (
    <div className="phone-local-note">
      <Button
        variant="ghost"
        onClick={async () => {
          try {
            const result = await request(
              linkPath,
              'GET',
              (v): v is { path: string } =>
                record(v) &&
                v.mode === 'LOCAL' &&
                text(v.path) &&
                /^\/workspace\/#invite=[A-Za-z0-9_-]{43}$/.test(v.path),
            );
            setPath(new URL(result.path, location.origin).href);
            setError('');
          } catch (e) {
            setError(e instanceof IdentityError ? e.message : '邀请暂不可读取。');
          }
        }}
      >
        查看本地邀请链接
      </Button>
      {path && (
        <>
          <input aria-label="本地邀请链接" value={path} readOnly onFocus={(e) => e.target.select()} />
          <small>仅供本地测试，未发送短信。复制后在受邀用户的浏览器会话中打开。</small>
        </>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
