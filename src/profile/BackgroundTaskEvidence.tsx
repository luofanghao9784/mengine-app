import { Disclosure } from '../components/Disclosure';
import { useState, type ReactNode } from 'react';
import { createIdentityRequest, record, uuid } from '../identity/client';
import { Failure, Loading, useRemote } from '../shared/admin';
const request = createIdentityRequest(fetch);
type Evidence = {
  taskId: string;
  attempt: number;
  knowledge?: { title: string; version: number }[];
  reconciliations?: {
    receiptId: string;
    period: { dateFrom: string; dateTo: string };
    sourceCount: number;
    amounts: Record<string, { cents: string; included: number; outside: number; unknown: number }>;
  }[];
  profiles: { entryId: string; revision: string; title: string }[];
  calculations: {
    metricId: string;
    name: string;
    version: number;
    datasetId: string;
    snapshotId: string;
    backgroundVersions: string;
  }[];
};
export function BackgroundTaskEvidence({
  tenant,
  conversation,
  task,
  children,
}: {
  children?: ReactNode;
  tenant: string;
  conversation: string;
  task: string;
}) {
  const [open, setOpen] = useState(false),
    [retry, setRetry] = useState(0);
  const data = useRemote(
    (signal) =>
      open
        ? request(
            `/api/v1/tenants/${tenant}/conversations/${conversation}/tasks/${task}/background-evidence`,
            'GET',
            (v): v is Evidence =>
              record(v) &&
              v.taskId === task &&
              Number.isSafeInteger(v.attempt) &&
              (v.knowledge === undefined ||
                (Array.isArray(v.knowledge) &&
                  v.knowledge.every(
                    (k) => record(k) && typeof k.title === 'string' && Number.isSafeInteger(k.version),
                  ))) &&
              (v.reconciliations === undefined ||
                (Array.isArray(v.reconciliations) &&
                  v.reconciliations.every(
                    (r) =>
                      record(r) &&
                      typeof r.receiptId === 'string' &&
                      record(r.period) &&
                      typeof r.period.dateFrom === 'string' &&
                      typeof r.period.dateTo === 'string' &&
                      Number.isSafeInteger(r.sourceCount) &&
                      record(r.amounts) &&
                      Object.values(r.amounts).every(
                        (a) =>
                          record(a) &&
                          typeof a.cents === 'string' &&
                          /^\d+$/.test(a.cents) &&
                          Number.isSafeInteger(a.included) &&
                          Number.isSafeInteger(a.outside) &&
                          Number.isSafeInteger(a.unknown),
                      ),
                  ))) &&
              Array.isArray(v.profiles) &&
              v.profiles.every(
                (p) =>
                  record(p) &&
                  uuid(p.entryId) &&
                  typeof p.revision === 'string' &&
                  typeof p.title === 'string',
              ) &&
              Array.isArray(v.calculations) &&
              v.calculations.every(
                (c) =>
                  record(c) &&
                  uuid(c.metricId) &&
                  typeof c.name === 'string' &&
                  Number.isSafeInteger(c.version) &&
                  uuid(c.datasetId) &&
                  uuid(c.snapshotId) &&
                  typeof c.backgroundVersions === 'string',
              ),
            undefined,
            signal,
          )
        : Promise.resolve(null),
    [tenant, conversation, task, open, retry],
  );
  return (
    <Disclosure title="详细执行记录" description="生成说明、读取与计算记录" onOpenChange={setOpen}>
      {children}
      {open &&
        (data.error ? (
          <Failure error={data.error} retry={() => setRetry((n) => n + 1)} />
        ) : !data.value ? (
          <Loading />
        ) : (
          <div>
            <p>以下来自实际读取和计算回执，未记录不代表已使用。</p>
            {!data.value.knowledge?.length &&
              !data.value.profiles.length &&
              !data.value.calculations.length &&
              !data.value.reconciliations?.length && <p>本次没有登记背景读取或治理指标计算。</p>}
            {data.value.knowledge
              ?.filter(
                (k, i, all) =>
                  all.findIndex((other) => other.title === k.title && other.version === k.version) === i,
              )
              .map((k, i) => (
                <p key={`knowledge-${i}`}>
                  已读取知识：{k.title} · v{k.version}
                </p>
              ))}
            {data.value.reconciliations
              ?.filter((r, i, all) => all.findIndex((other) => other.receiptId === r.receiptId) === i)
              .map((r) => (
                <div key={r.receiptId}>
                  <p>
                    收退款核查 · {r.period.dateFrom} 至 {r.period.dateTo} · {r.sourceCount} 个数据来源
                  </p>
                  {Object.entries(r.amounts).map(([key, a]) => (
                    <p key={key}>
                      {(
                        {
                          businessConfirmed: '业务确认收款',
                          financeConfirmedByReceiptDate: '按收款日期统计的财务已核对收款',
                          financeReviewedByReviewDate: '按核对日期统计的财务已核对收款',
                          cashRefund: '已确认现金退款',
                        } as Record<string, string>
                      )[key] ?? '其他核查项'}
                      ：{(BigInt(a.cents) / 100n).toString()}.
                      {(BigInt(a.cents) % 100n).toString().padStart(2, '0')} 元 · 纳入 {a.included} 条 ·
                      期间外 {a.outside} 条 · 金额或日期待核实 {a.unknown} 条
                    </p>
                  ))}
                  <p>
                    以上口径分别统计，不能相加；不代表银行到账、净收入或利润。使用既有数据，不代表实时情况。
                  </p>
                </div>
              ))}
            {data.value.profiles
              .filter(
                (p, i, all) =>
                  all.findIndex((other) => other.entryId === p.entryId && other.revision === p.revision) ===
                  i,
              )
              .map((p) => (
                <p key={p.entryId}>
                  背景 {p.title} · v{p.revision}
                </p>
              ))}
            {data.value.calculations
              .filter(
                (c, i, all) =>
                  all.findIndex(
                    (other) =>
                      other.metricId === c.metricId &&
                      other.version === c.version &&
                      other.snapshotId === c.snapshotId &&
                      other.backgroundVersions === c.backgroundVersions,
                  ) === i,
              )
              .map((c, i) => (
                <p key={i}>
                  方法 {c.name} · v{c.version}
                  <br />
                  数据快照 {c.snapshotId}
                  <br />
                  背景依据版本 {c.backgroundVersions}
                </p>
              ))}
          </div>
        ))}
    </Disclosure>
  );
}
