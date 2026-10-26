import { useState } from 'react';
import { useRemote } from '../../shared/admin';
import { usageClient } from '../../operations/usage-client';
import { UsageFacts, byte, numbers, periods, summarizeUsage, time } from '../../operations/UsagePanel';
import { usagePeriods, type UsagePeriod } from '../../../contracts/public-api/usage';
import { KnowledgeListRow } from './KnowledgeListRow';
import { Facts, ListHead, SectionTabs, errorText, useHashParams } from './section-kit';

/**
 * 用量与运行：统计期间是页签；左边是“全期汇总 + 每日”清单，中间是所选那一项的数值与趋势，右边是用量构成。
 * 口径沿用原用量页（只累计正式执行的已上报部分，未上报不计为零）。
 */
const week = ['日', '一', '二', '三', '四', '五', '六'];
const dayName = (date: string) => {
  const d = new Date(date + 'T00:00:00');
  return `${d.getMonth() + 1}月${d.getDate()}日 周${week[d.getDay()]}`;
};

export function UsageWork({ tenant }: { tenant: string }) {
  const [params, write] = useHashParams();
  const asked = params.get('period') as UsagePeriod | null;
  const period: UsagePeriod = asked && usagePeriods.includes(asked) ? asked : 'THIS_MONTH';
  const [attempt, setAttempt] = useState(0);
  const data = useRemote((s) => usageClient.read('tenant', tenant, period, s), [tenant, period, attempt]);
  const v = data.value && ('usage' in data.value ? data.value.usage : data.value);
  const picked = params.get('item') || 'all';
  const days = v ? [...v.days].reverse() : [];
  const day = days.find((d) => d.date === picked);
  const sum = v && summarizeUsage(v);
  const max = Math.max(1, ...(v?.days || []).flatMap((d) => [d.workRequests, d.maintenanceCalls ?? 0]));

  return (
    <section className="cards work glass section-work usage-work" aria-label="用量与运行">
      <article className="card list">
        <SectionTabs
          label="统计期间"
          tabs={usagePeriods.map((p) => [p, periods[p]])}
          active={period}
          onChange={(p) => write({ period: p, item: null }, true)}
        />
        <ListHead title="每日数值">
          <button
            type="button"
            className="icon"
            title="更新用量"
            aria-label="更新用量"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" />
            </svg>
          </button>
        </ListHead>
        <div className="card-scroll">
          {data.error ? (
            <p className="none">{errorText(data.error)}</p>
          ) : !v ? (
            <p className="none">正在读取用量…</p>
          ) : (
            <>
              <KnowledgeListRow
                name={`${periods[period]}汇总`}
                summary={`日常请求 ${numbers(sum?.work?.units ?? 0)} · Token ${numbers(sum?.tokens ?? null)}`}
                tone="run"
                selected={!day}
                onSelect={() => write({ item: null })}
              />
              {days.map((d) => (
                <KnowledgeListRow
                  key={d.date}
                  name={dayName(d.date)}
                  summary={`日常请求 ${numbers(d.workRequests)} · 维护调用 ${numbers(d.maintenanceCalls)}`}
                  side={d.unknownMaintenanceRuns ? `${d.unknownMaintenanceRuns} 次未知` : undefined}
                  tone={d.unknownMaintenanceRuns || d.maintenanceCalls === null ? 'warn' : d.workRequests || d.maintenanceCalls ? 'ok' : 'plain'}
                  selected={d.date === picked}
                  onSelect={() => write({ item: d.date })}
                />
              ))}
            </>
          )}
        </div>
      </article>

      <article className="card detail" aria-live="polite">
        {!v ? (
          <p className="none">{data.error ? errorText(data.error) : '正在读取用量…'}</p>
        ) : (
          <>
            <header>
              <h2>{day ? dayName(day.date) : `本企业 · ${periods[period]}用量`}</h2>
              <span>
                {time(v.from, v.timeZone)} 至 {time(v.until, v.timeZone)} · {v.timeZone}
              </span>
            </header>
            <div className="card-scroll">
              {day ? (
                <>
                  <p className={`verdict ${day.unknownMaintenanceRuns ? 'tone-warn' : ''}`}>
                    {day.unknownMaintenanceRuns
                      ? `有 ${day.unknownMaintenanceRuns} 次维护运行未上报调用数，未知部分不计为零。`
                      : day.workRequests || day.maintenanceCalls
                        ? '当日登记用量如下。'
                        : '当日没有登记；不代表不存在未接入的实际消耗。'}
                  </p>
                  <table>
                    <tbody>
                      <tr>
                        <th>日常登记请求</th>
                        <td className="num">{numbers(day.workRequests)}</td>
                      </tr>
                      <tr>
                        <th>维护回执调用</th>
                        <td className="num">{numbers(day.maintenanceCalls)}</td>
                      </tr>
                      <tr>
                        <th>调用数未知的运行</th>
                        <td className="num">{day.unknownMaintenanceRuns}</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              ) : (
                <>
                  <dl className="metric-tiles">
                    <div>
                      <dt>日常登记请求</dt>
                      <dd className="num">{numbers(sum?.work?.units ?? 0)}</dd>
                      <small>包含失败、取消与重试</small>
                    </div>
                    <div>
                      <dt>已上报 Token</dt>
                      <dd className="num">{numbers(sum?.tokens ?? null)}</dd>
                      <small>{sum?.incomplete ? '部分消耗未上报，仅累计已知值' : '正式执行 · 输入与输出合计'}</small>
                    </div>
                    <div>
                      <dt>工具执行登记</dt>
                      <dd className="num">{numbers(sum?.tools?.starts ?? 0)}</dd>
                      <small>
                        成功 {numbers(sum?.tools?.succeeded ?? 0)} · 失败 {numbers(sum?.tools?.failed ?? 0)} · 等待{' '}
                        {numbers(sum?.tools?.pending ?? 0)}
                      </small>
                    </div>
                    <div>
                      <dt>当前资料原件</dt>
                      <dd className="num">{byte(v.storage.registeredBytes)}</dd>
                      <small>
                        {numbers(v.storage.originals)} 份资料 · {numbers(v.storage.versions)} 个版本
                      </small>
                    </div>
                  </dl>
                  <div className="related">
                    <h3>计量明细与说明</h3>
                    <div className="legacy-skin usage-details">
                      <UsageFacts value={v} detailedOnly />
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="usage-chart" role="img" aria-label="每日日常请求与维护调用；点柱子查看当天数值">
              <div className="bars">
                {v.days.map((d) => (
                  <button
                    key={d.date}
                    type="button"
                    title={`${d.date}：日常 ${d.workRequests}，维护 ${numbers(d.maintenanceCalls)}`}
                    aria-pressed={d.date === picked}
                    onClick={() => write({ item: d.date })}
                  >
                    <i style={{ height: `${(d.workRequests / max) * 100}%` }} />
                    <i className="maintenance" style={{ height: `${((d.maintenanceCalls ?? 0) / max) * 100}%` }} />
                    <em>{d.date.slice(-2)}</em>
                  </button>
                ))}
              </div>
              <p>
                <i /> 日常请求 <i className="maintenance" /> 维护调用 · 无登记的日期为 0，不代表没有未接入的消耗
              </p>
            </div>
          </>
        )}
      </article>

      <div className="side">
        <Facts
          title="用量构成"
          rows={[
            ['输入 Token', v ? numbers(sum?.input ?? null) : undefined],
            ['输出 Token', v ? numbers(sum?.output ?? null) : undefined],
            ['维护回执调用', v ? (sum?.maintenance ? numbers(sum.maintenance.modelCalls) : '暂无记录') : undefined],
            ['使用成本', v ? '未接入' : undefined],
            ['企业额度', v ? '未配置' : undefined],
          ]}
        />
        <article className="card facts more">
          <header>
            <h2>口径</h2>
          </header>
          <div className="fact line">
            <span>Token 仅累计正式执行的已上报部分；剩余额度未知。</span>
          </div>
          <div className="fact line">
            <span>未接入、未上报的消耗不计为零。</span>
          </div>
          {v && <div className="fact line">
            <span>{v.coverage.legacyGovernanceJobs === undefined
              ? '平台尚未提供历史治理计量覆盖统计。'
              : `全历史另有 ${numbers(v.coverage.legacyGovernanceJobs)} 个治理任务的调用时间未核验；调用次数与 Token 未知，不计入所选月份或日期。`}</span>
          </div>}
          {v && (
            <div className="fact line">
              <span>读取于</span>
              <small>{time(v.checkedAt, v.timeZone)}</small>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
