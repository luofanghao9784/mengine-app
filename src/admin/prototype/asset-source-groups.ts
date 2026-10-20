/** Legacy import batches from the same confirmed business system. Display aliases only. */
const sourceAliases: Record<string, string> = {
  'local-9pop-payslips-20261015': '9POP 管理系统',
  'local-9pop-dividend_periods-20261015': '9POP 管理系统',
  '首批三表本地快照20261019': '9POP 管理系统',
};

export function assetSourceGroup(asset: { kind: string; source: string }) {
  const source = asset.source.split(' / ')[0].trim();
  const name = asset.kind === 'table' ? sourceAliases[source] || source || '其他数据来源' : source || '内部资料库';
  return { key: `${asset.kind}:${name}`, name };
}
