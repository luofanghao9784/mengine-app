import { Select } from '../shared/Select';
import { useState, type ReactNode } from 'react';
import { RefreshCw, ArrowLeft } from 'lucide-react';
import type {
  UsageClass,
  UsageOverview,
  UsagePeriod,
  ModelUsageGroup,
  UsageCost,
} from '../../contracts/public-api/usage';
import { usagePeriods } from '../../contracts/public-api/usage';
import { Button, Badge, PageActions } from '../shared/ui';
import { useRemote, Failure, Loading } from '../shared/admin';
import { useViewState } from '../shared/useViewState';
import { platformClient } from '../platform/client';
import { adminHref } from '../admin/navigation';
import { uuid } from '../identity/client';
import { usageClient as api } from './usage-client';
import { usageTrendState } from './usage-presentation';
import './usage.css';
export const numbers = (v: number | null) => (v === null ? '未知' : v.toLocaleString('zh-CN'));
const names: Record<UsageClass, string> = {
  live: '正式执行',
  verification: '合成验证',
  unknown: '执行类别未知',
};
export const periods: Record<UsagePeriod, string> = {
  THIS_MONTH: '本月',
  LAST_MONTH: '上月',
  LAST_30_DAYS: '近 30 天',
};
export const time = (s: string, zone: string) =>
  new Date(s).toLocaleString('zh-CN', { timeZone: zone, hour12: false });
export const byte = (n: number) =>
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
    <div className="usage-page platform-usage-summary">
      {tenant && (
        <a className="button ghost" href={adminHref('platform', 'usage', hash)}>
          <ArrowLeft size={16} />
          返回全平台用量
        </a>
      )}
      <UsagePanel key={tenant || 'all'} scope="platform" tenant={tenant} hash={hash} compact />
    </div>
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
  hash,
  compact = false,
}: {
  scope: 'platform' | 'tenant';
  tenant?: string | null;
  revision?: number;
  hash?: string;
  compact?: boolean;
}) {
  return (
    <ScopedUsage
      key={`${scope}:${tenant}`}
      scope={scope}
      tenant={tenant}
      revision={revision}
      hash={hash}
      compact={compact}
    />
  );
}
function ScopedUsage({
  scope,
  tenant,
  revision,
  hash,
  compact,
}: {
  scope: 'platform' | 'tenant';
  tenant: string | null;
  revision: number;
  hash?: string;
  compact: boolean;
}) {
  const [savedPeriod, setPeriod] = useViewState<UsagePeriod>(
    scope === 'platform' ? 'platform' : tenant!,
    `usage-period`,
    'THIS_MONTH',
    (v): v is UsagePeriod => usagePeriods.includes(v as UsagePeriod),
  );
  const requestedPeriod = new URLSearchParams(hash?.replace(/^#/, '')).get('period');
  const period = usagePeriods.includes(requestedPeriod as UsagePeriod)
    ? (requestedPeriod as UsagePeriod)
    : savedPeriod;
  const changePeriod = (next: UsagePeriod) => {
    setPeriod(next);
    if (hash !== undefined) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      params.set('period', next);
      window.location.hash = params.toString();
    }
  };
  const [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((n) => n + 1);
  const data = useRemote(
    (signal) => api.read(scope, tenant, period, signal),
    [scope, tenant, period, attempt, revision],
  );
  const value = data.value && ('usage' in data.value ? data.value.usage : data.value);
  const cost = data.value && 'cost' in data.value ? data.value.cost : undefined;
  const controls = (
    <div className="usage-filter">
      <Select
        aria-label="用量统计期间"
        value={period}
        onChange={(e) => changePeriod(e.target.value as UsagePeriod)}
      >
        {usagePeriods.map((p) => (
          <option value={p} key={p}>
            {periods[p]}
          </option>
        ))}
      </Select>
      <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
        更新用量
      </Button>
    </div>
  );
  return (
    <div className={`usage-page ${compact ? 'enterprise-usage' : ''}`}>
      {(scope === 'platform' || compact) && <PageActions>{controls}</PageActions>}
      {!compact && (
        <div className="usage-heading">
          <div>
            {scope === 'tenant' && <h2>本企业用量</h2>}
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
          {scope === 'tenant' && controls}
        </div>
      )}
      {compact && hash !== undefined && (
        <p className="admin-note usage-scope-note">
          {tenant ? (
            <>{scope === 'tenant' ? '本企业' : <TenantName tenant={tenant} />} · 运行与用量</>
          ) : (
            '全平台汇总 · 包含暂停服务企业与平台维护 · 仅正式执行'
          )}
        </p>
      )}
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !value ? (
        <Loading />
      ) : compact ? (
        <CompactUsageFacts value={value} cost={cost} />
      ) : (
        <UsageFacts value={value} cost={cost} />
      )}
    </div>
  );
}
/** 正式执行的汇总口径：企业管理端的用量卡片与这里的紧凑版共用。 */
export function summarizeUsage(v: UsageOverview) {
  const work = v.groups.find((g) => g.purpose === 'WORK' && g.executionClass === 'live');
  const maintenance = v.groups.find((g) => g.purpose === 'MAINTENANCE' && g.executionClass === 'live');
  const live = v.groups.filter((g) => g.executionClass === 'live');
  const tokenSum = (field: 'inputTokens' | 'outputTokens') =>
    live.length && live.every((g) => g[field] === null)
      ? null
      : live.reduce((sum, g) => sum + (g[field] ?? 0), 0);
  const input = tokenSum('inputTokens'),
    output = tokenSum('outputTokens');
  const tokens = input === null || output === null ? null : input + output;
  const incomplete = live.some(
    (g) => g.reportedUnits < g.units || g.inputTokens === null || g.outputTokens === null,
  );
  const tools = v.tools.find((t) => t.executionClass === 'live');
  return { work, maintenance, input, output, tokens, incomplete, tools };
}
function CompactUsageFacts({ value: v, cost }: { value: UsageOverview; cost?: UsageCost }) {
  const overall = v.tenantId === null;
  const { work, maintenance, input, output, tokens, incomplete, tools } = summarizeUsage(v);
  return (
    <>
      <dl className="usage-metrics">
        <div>
          <dt>日常登记请求</dt>
          <dd>{numbers(work?.units ?? 0)}</dd>
          <small>包含失败、取消与重试</small>
        </div>
        <div>
          <dt>已上报 Token</dt>
          <dd>{numbers(tokens)}</dd>
          <small>{incomplete ? '部分消耗未上报，仅累计已知值' : '正式执行 · 输入与输出合计'}</small>
        </div>
        <div>
          <dt>工具执行登记</dt>
          <dd>{numbers(tools?.starts ?? 0)}</dd>
          <small>
            成功 {numbers(tools?.succeeded ?? 0)} · 失败 {numbers(tools?.failed ?? 0)} · 等待{' '}
            {numbers(tools?.pending ?? 0)}
          </small>
        </div>
        <div>
          <dt>当前资料原件</dt>
          <dd>{byte(v.storage.registeredBytes)}</dd>
          <small>
            {numbers(v.storage.originals)} 份资料 · {numbers(v.storage.versions)} 个版本
          </small>
        </div>
      </dl>
      <div className="enterprise-usage-grid">
        <section className="enterprise-usage-card" aria-label="每日用量趋势">
          <h2>每日用量</h2>
          <Trend days={v.days} platform showDailyValues={false} />
        </section>
        <section className="enterprise-usage-card" aria-label="用量构成">
          <h2>{overall ? '全平台用量构成' : '用量构成'}</h2>
          <dl className="enterprise-usage-breakdown">
            <div>
              <dt>输入 Token</dt>
              <dd>{numbers(input)}</dd>
            </div>
            <div>
              <dt>输出 Token</dt>
              <dd>{numbers(output)}</dd>
            </div>
            <div>
              <dt>维护回执调用</dt>
              <dd>{maintenance ? numbers(maintenance.modelCalls) : '暂无记录'}</dd>
            </div>
            <div>
              <dt>使用成本</dt>
              <dd>{cost?.state === 'NOT_CONNECTED' ? '未接入' : '未知'}</dd>
            </div>
            <div>
              <dt>{overall ? '共享费用分摊' : '企业额度'}</dt>
              <dd>{overall ? '未分摊' : '未配置'}</dd>
            </div>
          </dl>
          <p className="admin-note">
            {overall
              ? 'Token 汇总企业与平台维护的已上报用量；成本未对账，不代表企业售价。'
              : 'Token 仅累计正式执行的已上报部分；剩余额度未知。'}
          </p>
        </section>
      </div>
      <section className="enterprise-usage-card enterprise-daily-card" aria-label="每日数值">
        <h2>每日数值</h2>
        <DailyValues days={v.days} />
      </section>
      <div className="enterprise-usage-footer">
        <p className="admin-note">
          统计：{time(v.from, v.timeZone)} 至 {time(v.until, v.timeZone)} · {v.timeZone}
          <br />
          读取于 {time(v.checkedAt, v.timeZone)}
        </p>
        <details className="usage-explanation enterprise-usage-details">
          <summary>计量明细与说明</summary>
          <UsageFacts value={v} cost={cost} detailedOnly />
        </details>
      </div>
    </>
  );
}
export function UsageFacts({
  value: v,
  cost,
  detailedOnly = false,
}: {
  value: UsageOverview;
  cost?: UsageCost;
  detailedOnly?: boolean;
}) {
  const platform = !!cost;
  const work = v.groups.find((g) => g.purpose === 'WORK' && g.executionClass === 'live');
  const maintenance = v.groups.find((g) => g.purpose === 'MAINTENANCE' && g.executionClass === 'live');
  const tools = v.tools.find((t) => t.executionClass === 'live');
  return (
    <>
      {!detailedOnly && (
        <p className="admin-note">
          统计：{time(v.from, v.timeZone)} 至 {time(v.until, v.timeZone)} · {v.timeZone}。读取于{' '}
          {time(v.checkedAt, v.timeZone)}。
        </p>
      )}
      {cost && <CostSummary cost={cost} />}
      {!detailedOnly && (
        <>
          <dl className="usage-metrics">
            <div>
              <dt>今日模型请求</dt>
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
              {platform
                ? '仅正式执行；日常请求与维护回执分别计量，不合并为账单。'
                : '仅正式执行。蓝色为日常请求开始登记，浅蓝为基础维护回执调用（归属运行开始日）；两种口径分别观察，不代表账单或业务效果。'}
            </p>
            <Trend days={v.days} platform={platform} />
          </section>
        </>
      )}
      <section className="admin-section usage-section" aria-label="用途与计量覆盖">
        <h2>用途与计量覆盖</h2>
        <p className="admin-note">Token 只累计已上报部分；未上报和未收到回执的消耗不能当作零。</p>
        <p className="admin-note">
          {v.coverage.legacyGovernanceJobs === undefined
            ? '平台尚未提供历史治理计量覆盖统计。'
            : `历史治理计量（全历史，不随期间筛选变化）：${numbers(v.coverage.legacyGovernanceJobs)} 个任务缺少可核验的调用开始时间；调用次数和 Token 未知，未纳入所选期间统计。`}
        </p>
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
        <UsageExplanation platform={platform} summary="查看用途与计量口径">
          <div className="usage-limits">
            <p>
              日常工作：按请求登记时间归集，包含会话、画报、失败、取消与重试；登记请求不保证已被供应商接收。
            </p>
            <p>
              基础维护：企业信息、数据治理、经验提炼与核验、通用经验处理。按运行开始时间归集回执；尚未收到或未记录的回执不可推算，历史类别未知单列。
            </p>
            <p>评测：尚未接入独立计量。自进化：未启用。合成验证不计作正式执行或实际费用。</p>
            {!platform && (
              <p>
                期间另有 {v.coverage.unmeteredWorkAttempts}{' '}
                次日常尝试未启用请求计量，不能补算为零。这里显示当前保留记录，不作为完整财务账本。
              </p>
            )}
          </div>
        </UsageExplanation>
        {platform && (
          <p className="admin-note">
            另有 {v.coverage.unmeteredWorkAttempts}{' '}
            次日常尝试未启用请求计量，不能补算为零；当前保留记录不作为完整财务账本。
          </p>
        )}
      </section>
      <section className="admin-section usage-section" aria-label="工具与存储">
        <h2>工具与存储</h2>
        {platform && <p className="admin-note">工具耗时包含回执传输延迟；原件登记量不含索引、导出与备份。</p>}
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
        <UsageExplanation platform={platform} summary="查看工具与存储口径">
          <p className="admin-note">
            耗时从服务端接收开始到最终回执，包含回执传输延迟；不代表纯 CPU 用时。维护内部工具尚未接入。另有{' '}
            {v.coverage.legacyToolReceipts}{' '}
            条历史回执无开始时间，按末次回执时间识别，未伪造耗时或混入每日开始量。
          </p>
          <p className="admin-note">
            原件为当前未登记物理清理的版本，包含历史版本及回收站，不随期间筛选变化；不含索引、导出与备份。
          </p>
        </UsageExplanation>
      </section>
      <section className="admin-section usage-section" aria-label="企业额度">
        <h2>{v.tenantId ? '企业额度' : '额度管理'}</h2>
        <Badge>未配置</Badge>
        {platform && <p className="admin-note">剩余额度未知，不以模型单次请求限制代替企业额度。</p>}
        <UsageExplanation platform={platform} summary="查看额度配置范围">
          <p className="admin-note">
            计量单位、周期、上限及超额策略尚未确定。
            {!platform && '剩余额度未知，不以模型单次请求限制代替企业额度。'}
          </p>
        </UsageExplanation>
      </section>
    </>
  );
}
function UsageExplanation({
  platform,
  summary,
  children,
}: {
  platform: boolean;
  summary: string;
  children: ReactNode;
}) {
  return platform ? (
    <details className="usage-explanation">
      <summary>{summary}</summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  );
}
function CostSummary({ cost }: { cost: UsageCost }) {
  return (
    <section className="usage-cost-summary" aria-label="运行成本">
      <h2>运行成本</h2>
      <dl>
        <div>
          <dt>已核实成本</dt>
          <dd>{cost.state === 'NOT_CONNECTED' ? '未接入' : '未知'}</dd>
        </div>
        <div>
          <dt>估算成本</dt>
          <dd>{cost.estimatedMinor === null ? '未配置' : '未知'}</dd>
        </div>
        <div>
          <dt>共享基础设施</dt>
          <dd>{cost.sharedAllocation === 'NOT_CONFIGURED' ? '未分摊' : '未知'}</dd>
        </div>
      </dl>
      <p className="admin-note">尚无供应商对账依据，平台运行成本不等于企业售价。</p>
      <details className="usage-explanation">
        <summary>查看成本口径</summary>
        <p className="admin-note">
          不以 Token 数猜测单价；共享费用独立列示，不假定企业分摊。计费架构、套餐和账单后续专题设计。
        </p>
      </details>
    </section>
  );
}
export function Trend({
  days,
  platform,
  showDailyValues = true,
}: {
  days: UsageOverview['days'];
  platform: boolean;
  showDailyValues?: boolean;
}) {
  const state = usageTrendState(days);
  const max = Math.max(1, ...days.flatMap((d) => [d.workRequests, d.maintenanceCalls ?? 0]));
  return (
    <div className="usage-trend">
      {state.hasKnownActivity ? (
        <>
          {platform && (
            <div className="usage-chart-key" aria-hidden="true">
              <span>
                <i />
                日常登记请求
              </span>
              <span>
                <i />
                维护回执调用
              </span>
            </div>
          )}
          <div
            className="usage-bars"
            role="img"
            aria-label="正式执行每日登记用量，日常请求与维护回执分别展示；确切数值见下方每日数值"
          >
            {days.map((d) => (
              <div
                key={d.date}
                title={`${d.date}：日常 ${d.workRequests}，维护 ${numbers(d.maintenanceCalls)}，维护调用数未知 ${d.unknownMaintenanceRuns} 次运行`}
              >
                <div>
                  <i style={{ height: `${(d.workRequests / max) * 100}%` }} />
                  <i
                    className={d.unknownMaintenanceRuns || d.maintenanceCalls === null ? 'incomplete' : ''}
                    style={{ height: `${((d.maintenanceCalls ?? 0) / max) * 100}%` }}
                  />
                </div>
                <small>{d.date.slice(-2)}</small>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="usage-trend-empty">
          <strong>该期间暂无已知每日用量</strong>
          <p className="admin-note">日常请求与已上报维护调用均无非零登记；未接入、未上报的消耗不计为零。</p>
        </div>
      )}
      {state.hasUnknownMaintenance && (
        <p className="admin-note usage-unknown-note">
          维护调用仍有未知值
          {state.unknownMaintenanceRuns > 0 ? `（${numbers(state.unknownMaintenanceRuns)} 次运行）` : ''}
          ，未知部分不计为零；{showDailyValues ? '可展开' : '可查看下方'}每日数值核对。
        </p>
      )}
      {showDailyValues && (
        <details>
          <summary>查看每日数值</summary>
          <DailyValues days={days} />
        </details>
      )}
      <p className="admin-note">
        无登记的日期显示 0 次登记，不代表不存在未接入的实际消耗
        {state.hasKnownActivity && '；带点线的维护柱包含调用数未知的运行'}。
      </p>
    </div>
  );
}

function DailyValues({ days }: { days: UsageOverview['days'] }) {
  return (
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
  );
}
