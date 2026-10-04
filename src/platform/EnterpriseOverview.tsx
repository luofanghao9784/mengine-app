import type { TenantDetail } from '../../contracts/public-api/platform-admin';
import { useRemote } from '../shared/admin';
import { usageClient } from '../operations/usage-client';
import { adminHref } from '../admin/navigation';
import { ownerStateLabel } from '../admin/platform-attention';

const number = (n: number) => n.toLocaleString('zh-CN');
const bytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KiB`
      : n < 1024 ** 3
        ? `${(n / 1024 ** 2).toFixed(1)} MiB`
        : `${(n / 1024 ** 3).toFixed(2)} GiB`;
export function EnterpriseOverview({
  detail,
  revision,
  hash,
}: {
  detail: TenantDetail;
  revision: number;
  hash: string;
}) {
  const data = useRemote(
    (signal) => usageClient.read('platform', detail.tenant.id, 'THIS_MONTH', signal),
    [detail.tenant.id, revision],
  );
  const usage = data.value && ('usage' in data.value ? data.value.usage : data.value);
  const groups = usage?.groups.filter((g) => g.executionClass === 'live');
  const work = groups?.filter((g) => g.purpose === 'WORK').reduce((sum, g) => sum + g.units, 0);
  const tokens = groups?.some((g) => g.inputTokens === null || g.outputTokens === null)
    ? null
    : groups?.reduce((sum, g) => sum + g.inputTokens! + g.outputTokens!, 0);
  const waiting = data.error ? '暂不可用' : '加载中';
  return (
    <div className="enterprise-overview-cards">
      <section className="enterprise-info-card" aria-label="企业信息">
        <h2>企业信息</h2>
        <dl>
          <div>
            <dt>负责人</dt>
            <dd>
              {detail.owner.state === 'ASSIGNED' ? detail.owner.name : ownerStateLabel[detail.owner.state]}
            </dd>
          </div>
          <div>
            <dt>开通时间</dt>
            <dd>{new Date(detail.createdAt).toLocaleString('zh-CN', { hour12: false })}</dd>
          </div>
        </dl>
      </section>
      <div className="enterprise-metric-grid">
        <section className="enterprise-metric-card">
          <h3>有效成员</h3>
          <strong>
            {number(detail.activeMemberCount)}
            <small>人</small>
          </strong>
          <p>当前企业中已启用的成员</p>
        </section>
        <section className="enterprise-metric-card">
          <h3>工作空间</h3>
          <strong>
            {number(detail.workspaceCount)}
            <small>个</small>
          </strong>
          <p>暂未提供空间配额，余量暂无数据</p>
        </section>
        <section className="enterprise-metric-card">
          <h3>资料存储</h3>
          <strong>{usage ? bytes(usage.storage.registeredBytes) : '—'}</strong>
          <p>
            {usage
              ? `${number(usage.storage.originals)} 份资料 · ${number(usage.storage.versions)} 个版本`
              : waiting}
          </p>
          <p>暂未提供存储配额，余量暂无数据</p>
        </section>
      </div>
      <section className="enterprise-usage-card" aria-label="本月用量概览">
        <div className="enterprise-card-heading">
          <h2>本月用量</h2>
          <a
            href={adminHref('platform', 'tenants', hash, { enterprise: detail.tenant.id, section: 'usage' })}
          >
            查看明细 →
          </a>
        </div>
        <div className="enterprise-usage-metrics">
          <div>
            <span>日常工作登记请求</span>
            <strong>{work === undefined ? '—' : number(work)}</strong>
            <small>正式执行，含失败与重试</small>
          </div>
          <div>
            <span>模型已登记 Token</span>
            <strong>{tokens === null ? '未知' : tokens === undefined ? '—' : number(tokens)}</strong>
            <small>正式执行，输入与输出合计</small>
          </div>
          <div>
            <span>使用成本</span>
            <strong>—</strong>
            <small>成本尚未接入</small>
          </div>
        </div>
        {usage ? (
          <p className="enterprise-usage-note">
            统计截至{' '}
            {new Date(usage.checkedAt).toLocaleString('zh-CN', { timeZone: usage.timeZone, hour12: false })}
            {usage.coverage.unmeteredWorkAttempts > 0
              ? ` · ${number(usage.coverage.unmeteredWorkAttempts)} 条工作执行尚未纳入计量`
              : ''}
          </p>
        ) : (
          <p className="enterprise-usage-note">
            {data.error ? '暂时无法获取用量，可在运行与用量中重试。' : '正在读取本月用量…'}
          </p>
        )}
      </section>
    </div>
  );
}
