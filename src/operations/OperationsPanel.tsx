import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { OperationsDays, OperationsOverview } from '../../contracts/public-api/operations';
import { Button } from '../shared/ui';
import { useRemote, Failure, Loading } from '../shared/admin';
import { getOperations, errorLabels } from './client';
import './operations.css';
const number = (value: number) => value.toLocaleString('zh-CN');
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const bytes = (value: number) =>
  value < 1024
    ? `${value} B`
    : value < 1024 ** 2
      ? `${(value / 1024).toFixed(1)} KiB`
      : value < 1024 ** 3
        ? `${(value / 1024 ** 2).toFixed(1)} MiB`
        : `${(value / 1024 ** 3).toFixed(2)} GiB`;
export function OperationsPanel({
  scope,
  tenant = null,
  revision = 0,
}: {
  scope: 'platform' | 'tenant';
  tenant?: string | null;
  revision?: number;
}) {
  // Remount on permission scope changes so a previous tenant's snapshot is never rendered under a new heading.
  return <ScopedPanel key={`${scope}:${tenant}`} scope={scope} tenant={tenant} revision={revision} />;
}
function ScopedPanel({
  scope,
  tenant,
  revision,
}: {
  scope: 'platform' | 'tenant';
  tenant: string | null;
  revision: number;
}) {
  const [days, setDays] = useState<OperationsDays>(7),
    [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((v) => v + 1);
  const data = useRemote(
    (signal) => getOperations(scope, tenant, days, signal),
    [scope, tenant, days, attempt, revision],
  );
  return (
    <section className="access-panel operations-panel" aria-label="运行概览">
      <div className="operations-heading">
        <div>
          <h2>运行概览</h2>
          <p className="muted">{tenant ? '本企业' : '全平台（含已停用企业）'}的任务与原件存储统计</p>
        </div>
        <div className="operations-controls">
          <select
            aria-label="统计范围"
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as OperationsDays)}
          >
            <option value={7}>最近 7 天</option>
            <option value={30}>最近 30 天</option>
          </select>
          <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
            更新统计
          </Button>
        </div>
      </div>
      {data.error ? (
        <Failure error={data.error} retry={refresh} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <Snapshot value={data.value} />
      )}
    </section>
  );
}
function Snapshot({ value }: { value: OperationsOverview }) {
  const { tasks, storage } = value;
  return (
    <>
      <p className="operations-note">按任务创建时间统计，展示截至刷新时的状态。重试仍计为同一个任务。</p>
      <dl className="operations-metrics">
        {(
          [
            ['创建任务', tasks.total],
            ['已完成', tasks.succeeded],
            ['失败 / 中断', tasks.failed + tasks.interrupted],
            ['排队 / 执行中', tasks.queued + tasks.running],
          ] as const
        ).map(([label, n]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{number(n)}</dd>
          </div>
        ))}
      </dl>
      <p className="operations-note">
        已取消 {number(tasks.cancelled)} · 重试已启动 {number(tasks.retryStarts)} 次
      </p>
      <div className="operations-block">
        <h3>原件存储</h3>
        <div className="operations-storage">
          <strong>{bytes(storage.originalBytes)}</strong>
          <span>
            {number(storage.materials)} 份资料 · {number(storage.versions)} 个版本
          </span>
        </div>
        <p className="operations-note">
          当前全部已保存原件，含历史版本，不受上方时间范围影响。不含解析索引、任务附件、文稿导出及备份。
        </p>
      </div>
      <div className="operations-block">
        <h3>各次尝试的模型用量</h3>
        <p className="operations-note">
          按尝试开始时间统计，包含失败、取消和重试。仅覆盖启用记录后的尝试，历史记录不补算。请求数是调用前登记数，不代表供应商实际接收数。
        </p>
        {value.attemptUsage.length ? (
          <div className="operations-models">
            {value.attemptUsage.map((m) => (
              <article key={m.executionClass} className="operations-model">
                <h4>{m.executionClass === 'verification' ? '本地验证（合成模型）' : '正式模型调用'}</h4>
                <p>
                  {number(m.attempts)} 次尝试 · {number(m.requests)} 次登记请求
                </p>
                <p className="operations-note">
                  成功 {number(m.succeeded)} · 失败 {number(m.failed)} · 取消 {number(m.cancelled)} · 中断{' '}
                  {number(m.interrupted)} · 执行中 {number(m.running)}
                </p>
                <dl>
                  <div>
                    <dt>已上报输入 Token</dt>
                    <dd>{m.inputTokens === null ? '未知' : number(m.inputTokens)}</dd>
                  </div>
                  <div>
                    <dt>已上报输出 Token</dt>
                    <dd>{m.outputTokens === null ? '未知' : number(m.outputTokens)}</dd>
                  </div>
                </dl>
                <p className="operations-note">
                  用量已知 {number(m.reportedRequests)} / {number(m.requests)} 次请求；未知{' '}
                  {number(m.requests - m.reportedRequests)} 次，其中未收到回执 {number(m.pendingRequests)}{' '}
                  次。未启用计量 {number(m.attempts - m.meteredAttempts)} 次尝试。
                </p>
                <p className="operations-note">
                  单次尝试最多 8 次模型请求，每次最多申请 2,048 个输出
                  Token。这是执行限制，不能作为费用上限或账单。
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="operations-empty">该时段暂无尝试级记录。</p>
        )}
      </div>
      <details className="operations-block">
        <summary>成功任务的历史回执（旧口径）</summary>
        <h3>成功任务的模型用量</h3>
        <p className="operations-note">
          仅汇总成功 Agent 任务最后一次尝试上报的调用量。失败、中断和此前尝试的消耗未完整计入，不能作为账单。
        </p>
        {value.models.length ? (
          <div className="operations-models">
            {value.models.map((m) => (
              <article key={m.executionClass} className="operations-model">
                <h4>{m.executionClass === 'verification' ? '本地验证（合成模型）' : '正式模型调用'}</h4>
                <p>
                  {number(m.succeededTasks)} 个成功任务 · {number(m.modelCalls)} 次模型请求
                </p>
                <dl>
                  <div>
                    <dt>输入 Token</dt>
                    <dd>{m.inputTokens === null ? '未上报' : number(m.inputTokens)}</dd>
                  </div>
                  <div>
                    <dt>输出 Token</dt>
                    <dd>{m.outputTokens === null ? '未上报' : number(m.outputTokens)}</dd>
                  </div>
                </dl>
                <p className="operations-note">
                  Token 已上报 {number(m.reportedTasks)} / {number(m.succeededTasks)} 个任务
                  {m.reportedTasks < m.succeededTasks ? '，当前数值不完整' : ''}。
                  {m.executionClass === 'verification'
                    ? '合成用量不代表云模型费用。'
                    : '实际费用以供应商账单为准。'}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="operations-empty">该时段暂无成功 Agent 任务，模型用量不可得。</p>
        )}
      </details>
      <div className="operations-block">
        <h3>当前异常</h3>
        <p className="operations-note">
          仅包含该时段创建、目前仍失败或中断的任务；重试恢复后会移出。错误按固定类型归类，不显示任务内容。
        </p>
        {value.errors.length ? (
          <ul className="operations-errors">
            {value.errors.map((e) => (
              <li key={e.code}>
                <span>
                  <strong>{errorLabels[e.code]}</strong>
                  <small>最近发生于 {time(e.lastOccurredAt)}</small>
                </span>
                <span>{number(e.tasks)} 个任务</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="operations-empty">当前统计范围内没有失败或中断的任务。</p>
        )}
      </div>
      <p className="operations-note operations-timestamp">
        {time(value.from)} — {time(value.checkedAt)} · 手动刷新
      </p>
    </>
  );
}
