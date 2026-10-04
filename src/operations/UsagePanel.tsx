import { useState } from 'react';
import { RefreshCw, Search, ArrowLeft, ChevronRight } from 'lucide-react';
import type {
  UsageClass,
  UsageOverview,
  UsagePeriod,
  ModelUsageGroup,
} from '../../contracts/public-api/usage';
import { usagePeriods } from '../../contracts/public-api/usage';
import { Button, Badge } from '../shared/ui';
import { useRemote, Failure, Loading, Pager } from '../shared/admin';
import { useViewState, textState, pageState } from '../shared/useViewState';
import { platformClient } from '../platform/client';
import { adminHref } from '../admin/navigation';
import { uuid } from '../identity/client';
import { usageClient as api } from './usage-client';
import './usage.css';
const numbers = (v: number | null) => (v === null ? '未知' : v.toLocaleString('zh-CN'));
const names: Record<UsageClass, string> = {
  live: '正式执行',
  verification: '合成验证',
  unknown: '执行类别未知',
};
const periods: Record<UsagePeriod, string> = {
  THIS_MONTH: '本月',
  LAST_MONTH: '上月',
  LAST_30_DAYS: '近 30 天',
};
const time = (s: string, zone: string) =>
  new Date(s).toLocaleString('zh-CN', { timeZone: zone, hour12: false });
const byte = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KiB`
      : n < 1024 ** 3
        ? `${(n / 1024 ** 2).toFixed(1)} MiB`
        : `${(n / 1024 ** 3).toFixed(2)} GiB`;
const purpose = (g: ModelUsageGroup) => (g.purpose === 'WORK' ? '日常工作' : '基础维护');
export function PlatformUsagePage({ hash }: { hash: string }) {
  const requested = new URLSearchParams(hash.slice(1)).get('enterprise');
  const tenant = uuid(requested) ? requested : null;
  return (
    <div className="usage-page">
      {tenant && (
        <a className="button ghost" href={adminHref('platform', 'usage', hash)}>
          <ArrowLeft size={16} />
          返回全平台用量
        </a>
      )}
      <UsagePanel key={tenant || 'all'} scope="platform" tenant={tenant} />
      <TenantUsageDirectory hash={hash} />
    </div>
  );
}
function TenantUsageDirectory({ hash }: { hash: string }) {
  const [query, setQuery] = useViewState('platform', 'usage-tenant-query', '', textState);
  const [draft, setDraft] = useState(query);
  const [page, setPage] = useViewState('platform', 'usage-tenant-page', 0, pageState);
  const [attempt, setAttempt] = useState(0);
  const data = useRemote(
    (signal) => platformClient.tenants(query, '', page * 20, 21, signal),
    [query, page, attempt],
  );
  return (
    <section className="admin-section usage-section" aria-label="按企业查看用量">
      <h2>按企业查看</h2>
      <form
        className="usage-filter"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setQuery(draft.trim());
        }}
      >
        <input
          aria-label="搜索企业"
          placeholder="搜索企业名称"
          value={draft}
          maxLength={100}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" icon={Search}>
          搜索
        </Button>
      </form>
      {data.error ? (
        <Failure error={data.error} retry={() => setAttempt((a) => a + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : data.value.length ? (
        <>
          <div className="usage-directory">
            {data.value.slice(0, 20).map((t) => (
              <a key={t.id} href={adminHref('platform', 'usage', hash, { enterprise: t.id })}>
                <span>
                  {t.name}
                  <small>{t.status === 'ACTIVE' ? '正常服务' : '服务暂停'}</small>
                </span>
                <span>
                  查看用量
                  <ChevronRight size={15} />
                </span>
              </a>
            ))}
          </div>
          <Pager page={page} next={data.value.length > 20} onPage={setPage} />
        </>
      ) : (
        <p className="admin-note">没有匹配的企业。</p>
      )}
    </section>
  );
}
function TenantName({ tenant }: { tenant: string }) {
  const data = useRemote((signal) => platformClient.detail(tenant, signal), [tenant]);
  return <span>{data.value?.tenant.name || '所选企业'}</span>;
}
export function UsagePanel({
  scope,
  tenant = null,
  revision = 0,
}: {
  scope: 'platform' | 'tenant';
  tenant?: string | null;
  revision?: number;
}) {
  return <ScopedUsage key={`${scope}:${tenant}`} scope={scope} tenant={tenant} revision={revision} />;
}
function ScopedUsage({
  scope,
  tenant,
  revision,
}: {
  scope: 'platform' | 'tenant';
  tenant: string | null;
  revision: number;
}) {
  const [period, setPeriod] = useViewState<UsagePeriod>(
    scope === 'platform' ? 'platform' : tenant!,
    `usage-period`,
    'THIS_MONTH',
    (v): v is UsagePeriod => usagePeriods.includes(v as UsagePeriod),
  );
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((n) => n + 1);
  const data = useRemote(
    (signal) => api.read(scope, tenant, period, signal),
    [scope, tenant, period, attempt, revision],
  );
  const value = data.value && ('usage' in data.value ? data.value.usage : data.value);
  return (
    <div className="usage-page">
      <div className="usage-heading">
        <div>
          <h2>{scope === 'platform' ? '用量与成本' : '本企业用量'}</h2>
          <p className="admin-note">
            {scope === 'platform' ? (
              tenant ? (
                <TenantName tenant={tenant} />
              ) : (
                '全平台 · 包含暂停服务企业和平台维护'
              )
            ) : (
              '当前企业范围'
            )}
          </p>
        </div>
        <div className="usage-filter">
          <select
            aria-label="用量统计期间"
            value={period}
            onChange={(e) => setPeriod(e.target.value as UsagePeriod)}
          >
            {usagePeriods.map((p) => (
              <option value={p} key={p}>
                {periods[p]}
              </option>
            ))}
          </select>
          <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
            更新用量
          </Button>
        </div>
      </div>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !value ? (
        <Loading />
      ) : (
        <UsageFacts value={value} platform={scope === 'platform'} />
      )}
    </div>
  );
}
function UsageFacts({ value: v, platform }: { value: UsageOverview; platform: boolean }) {
  const work = v.groups.find((g) => g.purpose === 'WORK' && g.executionClass === 'live');
  const maintenance = v.groups.find((g) => g.purpose === 'MAINTENANCE' && g.executionClass === 'live');
  const tools = v.tools.find((t) => t.executionClass === 'live');
  return (
    <>
      <p className="admin-note">
        统计：{time(v.from, v.timeZone)} 至 {time(v.until, v.timeZone)} · {v.timeZone}。读取于{' '}
        {time(v.checkedAt, v.timeZone)}。
      </p>
      <dl className="usage-metrics">
        <div>
          <dt>日常模型登记请求</dt>
          <dd>{numbers(work?.modelCalls ?? 0)}</dd>
          <small>正式执行 · 包含失败与重试</small>
        </div>
        <div>
          <dt>维护模型回执调用</dt>
          <dd>{maintenance ? numbers(maintenance.modelCalls) : '暂无记录'}</dd>
          <small>正式执行 · 仅已收到的回执</small>
        </div>
        <div>
          <dt>工具执行登记</dt>
          <dd>{numbers(tools?.starts ?? 0)}</dd>
          <small>正式执行 · 等待回执 {numbers(tools?.pending ?? 0)}</small>
        </div>
        <div>
          <dt>当前原件登记量</dt>
          <dd>{byte(v.storage.registeredBytes)}</dd>
          <small>
            {numbers(v.storage.originals)} 份资料 · {numbers(v.storage.versions)} 个版本
          </small>
        </div>
      </dl>
      <section className="admin-section usage-section" aria-label="每日用量趋势">
        <h2>每日用量</h2>
        <p className="admin-note">
          仅正式执行。蓝色为日常请求开始登记，浅蓝为基础维护回执调用（归属运行开始日）；两种口径分别观察，不代表账单或业务效果。
        </p>
        <Trend days={v.days} />
      </section>
      <section className="admin-section usage-section" aria-label="用途与计量覆盖">
        <h2>用途与计量覆盖</h2>
        <p className="admin-note">Token 只累计已上报部分；未上报和未收到回执的消耗不能当作零。</p>
        {v.groups.length ? (
          <div className="usage-groups">
            {v.groups.map((g) => (
              <article key={`${g.purpose}:${g.executionClass}`}>
                <div className="usage-heading">
                  <h3>{purpose(g)}</h3>
                  <Badge>{names[g.executionClass]}</Badge>
                </div>
                <dl>
                  <div>
                    <dt>{g.basis === 'REQUEST_STARTED' ? '登记请求' : '维护运行'}</dt>
                    <dd>{numbers(g.units)}</dd>
                  </div>
                  <div>
                    <dt>{g.purpose === 'WORK' ? '登记调用' : '回执调用'}</dt>
                    <dd>{numbers(g.modelCalls)}</dd>
                  </div>
                  <div>
                    <dt>已上报输入 Token</dt>
                    <dd>{numbers(g.inputTokens)}</dd>
                  </div>
                  <div>
                    <dt>已上报输出 Token</dt>
                    <dd>{numbers(g.outputTokens)}</dd>
                  </div>
                </dl>
                <small>
                  Token 完整回执 {g.reportedUnits} / {g.units}{' '}
                  {g.basis === 'REQUEST_STARTED' ? '次请求' : '次运行'} · 调用数未知 {g.unknownCallUnits} ·
                  等待或结果待核对 {g.pendingUnits}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <p className="admin-note">该期间暂无模型计量记录。</p>
        )}
        <div className="usage-limits">
          <p>
            日常工作：按请求登记时间归集，包含会话、画报、失败、取消与重试；登记请求不保证已被供应商接收。
          </p>
          <p>
            基础维护：企业信息、经验提炼与核验、通用经验处理。按运行开始时间归集回执；尚未收到或未记录的回执不可推算，历史类别未知单列。
          </p>
          <p>评测：尚未接入独立计量。自进化：未启用。合成验证不计作正式执行或实际费用。</p>
          <p>
            期间另有 {v.coverage.unmeteredWorkAttempts}{' '}
            次日常尝试未启用请求计量，不能补算为零。这里显示当前保留记录，不作为完整财务账本。
          </p>
        </div>
      </section>
      <section className="admin-section usage-section" aria-label="工具与存储">
        <h2>工具与存储</h2>
        {v.tools.length ? (
          v.tools.map((t) => (
            <div className="usage-tool" key={t.executionClass}>
              <strong>{names[t.executionClass]}</strong>
              <p>
                登记 {t.starts} 次 · 成功 {t.succeeded} · 失败 {t.failed} · 等待最终回执 {t.pending}
              </p>
              <p>
                已知登记耗时{' '}
                {t.elapsedMillis === null
                  ? '未知'
                  : `${(t.elapsedMillis / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 秒`}{' '}
                · 覆盖 {t.timed} / {t.starts} 次
              </p>
            </div>
          ))
        ) : (
          <p className="admin-note">该期间暂无带开始时间的工具记录。</p>
        )}
        <p className="admin-note">
          耗时从服务端接收开始到最终回执，包含回执传输延迟；不代表纯 CPU 用时。维护内部工具尚未接入。另有{' '}
          {v.coverage.legacyToolReceipts}{' '}
          条历史回执无开始时间，按末次回执时间识别，未伪造耗时或混入每日开始量。
        </p>
        <p className="admin-note">
          原件为当前未登记物理清理的版本，包含历史版本及回收站，不随期间筛选变化；不含索引、导出与备份。
        </p>
      </section>
      {platform && (
        <section className="admin-section usage-section" aria-label="运行成本">
          <h2>运行成本</h2>
          <dl className="usage-metrics">
            <div>
              <dt>已核实成本</dt>
              <dd>未接入</dd>
              <small>尚无供应商对账依据</small>
            </div>
            <div>
              <dt>估算成本</dt>
              <dd>未配置</dd>
              <small>不以 Token 数猜测单价</small>
            </div>
            <div>
              <dt>共享基础设施</dt>
              <dd>未分摊</dd>
              <small>独立列示，不假定企业分摊</small>
            </div>
          </dl>
          <p className="admin-note">平台运行成本不等于企业售价。计费架构、套餐和账单后续专题设计。</p>
        </section>
      )}
      <section className="admin-section usage-section" aria-label="企业额度">
        <h2>{v.tenantId ? '企业额度' : '额度管理'}</h2>
        <Badge>未配置</Badge>
        <p className="admin-note">
          计量单位、周期、上限及超额策略尚未确定。剩余额度未知，不以模型单次请求限制代替企业额度。
        </p>
      </section>
    </>
  );
}
function Trend({ days }: { days: UsageOverview['days'] }) {
  const max = Math.max(1, ...days.flatMap((d) => [d.workRequests, d.maintenanceCalls ?? 0]));
  return (
    <div className="usage-trend">
      <div className="usage-bars" role="img" aria-label="正式执行每日登记用量">
        {days.map((d) => (
          <div
            key={d.date}
            title={`${d.date}：日常 ${d.workRequests}，维护 ${numbers(d.maintenanceCalls)}，维护调用数未知 ${d.unknownMaintenanceRuns} 次运行`}
          >
            <div>
              <i style={{ height: `${(d.workRequests / max) * 100}%` }} />
              <i
                className={d.unknownMaintenanceRuns ? 'incomplete' : ''}
                style={{ height: `${((d.maintenanceCalls ?? 0) / max) * 100}%` }}
              />
            </div>
            <small>{d.date.slice(-2)}</small>
          </div>
        ))}
      </div>
      <details>
        <summary>查看每日数值</summary>
        <div className="usage-table">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>日常请求</th>
                <th>维护调用</th>
                <th>调用未知运行</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td>{numbers(d.workRequests)}</td>
                  <td>{numbers(d.maintenanceCalls)}</td>
                  <td>{d.unknownMaintenanceRuns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="admin-note">
        无登记的日期显示 0 次登记，不代表不存在未接入的实际消耗；带点线的维护柱包含调用数未知的运行。
      </p>
    </div>
  );
}
