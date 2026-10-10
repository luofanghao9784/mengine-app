import { useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { platformClient } from '../platform/client';
import { getTelemetry } from '../operations/telemetry-client';
import { usageClient } from '../operations/usage-client';
import { StorageAlert } from '../operations/PlatformStorage';
import { Button, PageActions } from '../shared/ui';
import { Failure, Loading, useRemote } from '../shared/admin';
import { adminHref } from './navigation';
import { overviewAttention, ownerStateLabel } from './platform-attention';
import './platform-overview.css';

export function PlatformOverviewPage({ hash }: { hash: string }) {
  const [attempt, setAttempt] = useState(0);
  const summary = useRemote((signal) => platformClient.overview(signal), [attempt]);
  const tenants = useRemote((signal) => platformClient.tenants('', '', 0, 21, signal), [attempt]);
  const operations = useRemote((signal) => getTelemetry('platform', null, signal), [attempt]);
  const usage = useRemote((signal) => usageClient.read('platform', null, 'THIS_MONTH', signal), [attempt]);
  const monthly = usage.value && ('usage' in usage.value ? usage.value.usage : usage.value);
  const work = monthly?.groups.find((g) => g.purpose === 'WORK' && g.executionClass === 'live');
  const maintenance = monthly?.groups.find((g) => g.purpose === 'MAINTENANCE' && g.executionClass === 'live');
  const attention = overviewAttention(tenants.value || [], operations.value);
  const running = operations.value?.channels.reduce((n, channel) => n + channel.running, 0);
  const queued = operations.value?.channels.reduce((n, channel) => n + channel.queued, 0);
  const runtimeHref = adminHref('platform', 'engine', hash);
  const enterpriseHref = adminHref('platform', 'tenants', hash);
  const usageHref = adminHref('platform', 'usage', hash, { period: 'THIS_MONTH' });
  const refresh = () => setAttempt((n) => n + 1);
  return (
    <div className="platform-dashboard">
      <PageActions>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新
        </Button>
      </PageActions>
      <section className="platform-status-strip" aria-label="平台关键状态">
        <dl>
          <div>
            <dt>企业服务</dt>
            <dd>
              {summary.value ? (
                <>
                  {summary.value.activeTenants}
                  <small> / {summary.value.totalTenants} 家正常服务</small>
                </>
              ) : (
                '暂未获取'
              )}
            </dd>
            <a href={enterpriseHref}>
              {summary.value
                ? `${summary.value.pendingTenants ?? 0} 家待激活 · ${summary.value.suspendedTenants} 家已暂停 · 查看企业`
                : '查看企业'}
            </a>
          </div>
          <div>
            <dt>登记执行中</dt>
            <dd>{running === undefined ? '—' : running}</dd>
            <a href={runtimeHref}>查看已接入的运行记录</a>
          </div>
          <div>
            <dt>登记排队</dt>
            <dd>{queued === undefined ? '—' : queued}</dd>
            <span>按运行记录统计，非物理并发</span>
          </div>
        </dl>
        {!!summary.error && <Failure error={summary.error} retry={refresh} />}
      </section>
      <div className="platform-overview-columns">
        <section className="admin-section platform-attention" aria-label="需要关注">
          <div className="admin-section-heading">
            <h2>需要关注</h2>
            <a href={runtimeHref}>
              运行状态 <ArrowRight size={14} aria-hidden="true" />
            </a>
          </div>
          <div className="platform-attention-group">
            <h3>企业接手</h3>
            {tenants.error ? (
              <Failure error={tenants.error} retry={refresh} />
            ) : !tenants.value ? (
              <Loading />
            ) : (
              <>
                {attention.owners.length ? (
                  <ul className="platform-attention-list">
                    {attention.owners.slice(0, 4).map((tenant) => (
                      <li key={tenant.id}>
                        <a href={adminHref('platform', 'tenants', hash, { enterprise: tenant.id })}>
                          <span>
                            <strong>{tenant.name}</strong>
                            <small>
                              {ownerStateLabel[tenant.owner.state]} ·{' '}
                              {tenant.status === 'ACTIVE' ? '服务正常' : '服务已暂停'}
                            </small>
                          </span>
                          <ArrowRight size={16} aria-hidden="true" />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="admin-note">当前检查范围内暂无待接手企业。</p>
                )}
                <p className="platform-coverage">
                  已检查最近开通的 {attention.observedTenants} 家企业
                  {attention.moreTenants ? '，更多企业请进入企业管理' : ''}。
                  {attention.owners.length > 4 && <a href={enterpriseHref}> 查看其余待接手企业</a>}
                </p>
              </>
            )}
          </div>
          <div className="platform-attention-group">
            <h3>运行与监测</h3>
            {operations.error ? (
              <Failure error={operations.error} retry={refresh} />
            ) : !operations.value ? (
              <Loading />
            ) : (
              <>
                {attention.unknown! > 0 && (
                  <p>
                    <a href={runtimeHref}>{attention.unknown} 项运行结果待核对</a>
                  </p>
                )}
                {attention.waiting! > 0 && (
                  <p>
                    <a href={runtimeHref}>{attention.waiting} 项运行处于等待状态</a>
                  </p>
                )}
                {attention.retainedFailures! > 0 && (
                  <p>
                    <a href={runtimeHref}>{attention.retainedFailures} 条保留的失败或中断记录</a>
                    <small className="platform-coverage">含历史尝试，需在运行页查看。</small>
                  </p>
                )}
                {!attention.unknown && !attention.waiting && !attention.retainedFailures && (
                  <p className="admin-note">已接入记录中暂无待核对、等待或保留异常。</p>
                )}
                <p className="platform-coverage">
                  快照 {new Date(operations.value.checkedAt).toLocaleString('zh-CN', { hour12: false })} ·
                  等待、排队与历史异常不自动转为人工待办。
                </p>
              </>
            )}
            <StorageAlert key={attempt} hash={hash} />
            <details className="platform-overview-notes">
              <summary>监测范围与状态口径</summary>
              <p>
                仅汇总已接入的运行记录，不代表全部服务正常。数据库查看接入与取数，资料库查看资料解析；监测未接入时，当前情况未知。
              </p>
              <a href={adminHref('platform', 'database', hash)}>查看数据库运行</a>
            </details>
          </div>
        </section>
        <section className="admin-section platform-monthly" aria-label="本月用量摘要">
          <div className="admin-section-heading">
            <h2>本月用量与成本</h2>
            <a href={usageHref}>
              查看明细 <ArrowRight size={14} aria-hidden="true" />
            </a>
          </div>
          {usage.error ? (
            <Failure error={usage.error} retry={refresh} />
          ) : !monthly ? (
            <Loading />
          ) : (
            <>
              <dl className="platform-monthly-values">
                <div>
                  <dt>日常模型登记请求</dt>
                  <dd>{(work?.modelCalls ?? 0).toLocaleString('zh-CN')}</dd>
                  <small>正式执行 · 包含失败与重试</small>
                </div>
                <div>
                  <dt>维护模型回执调用</dt>
                  <dd>{maintenance?.modelCalls?.toLocaleString('zh-CN') ?? '—'}</dd>
                  <small>
                    {!maintenance
                      ? '暂无维护记录'
                      : maintenance.modelCalls === null
                        ? '回执调用数未知'
                        : '正式执行 · 仅已收到的回执'}
                  </small>
                </div>
              </dl>
              <div className="platform-cost-status">
                <strong>成本尚未接入</strong>
                <p>采购成本待核实，共享费用尚未分摊。</p>
              </div>
              <p className="platform-coverage">
                本月截至{' '}
                {new Date(monthly.until).toLocaleString('zh-CN', {
                  timeZone: monthly.timeZone,
                  hour12: false,
                })}{' '}
                · {monthly.timeZone}
              </p>
              <details className="platform-overview-notes">
                <summary>用量统计口径</summary>
                <p>
                  仅统计当前保留的正式执行记录，不作为完整账单。合成验证及历史类别未知另列；缺失回执不计为零。
                  {maintenance?.unknownCallUnits
                    ? `${maintenance.unknownCallUnits} 次维护运行的调用数尚未知。`
                    : ''}
                </p>
              </details>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
