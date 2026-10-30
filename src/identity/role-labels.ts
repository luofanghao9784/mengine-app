/** Display labels only; authorization continues to use server-enforced permissions. */
export function roleLabel({
  role,
  owner,
  platformAdmin,
  realm,
  canConfigure,
  canMaintain,
}: {
  role?: string;
  owner?: boolean;
  platformAdmin?: boolean;
  realm?: 'customer' | 'platform' | 'agent';
  canConfigure?: boolean;
  canMaintain?: boolean;
}): string | undefined {
  if (platformAdmin || realm === 'platform' || realm === 'agent') return '总部管理员';
  if (owner || role === 'OWNER') return '企业负责人';
  if (role === 'TENANT_ADMIN' || role === 'ADMIN')
    return canConfigure === false ? '企业管理员（权限受限）' : '企业管理员';
  if (role === 'MEMBER') return canMaintain ? '成员 · 可维护空间' : '成员';
  return undefined;
}
