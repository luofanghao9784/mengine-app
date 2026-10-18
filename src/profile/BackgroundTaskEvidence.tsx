import { useState } from 'react';
import { createIdentityRequest, record, uuid } from '../identity/client';
import { Failure, Loading, useRemote } from '../shared/admin';
const request = createIdentityRequest(fetch);
type Evidence = {
  taskId: string;
  attempt: number;
  profiles: { entryId: string; revision: string; title: string }[];
  calculations: {
    metricId: string; name: string;
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
}: {
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
              Array.isArray(v.profiles) &&
              v.profiles.every((p) => record(p) && uuid(p.entryId) && typeof p.revision === 'string' && typeof p.title === 'string') &&
              Array.isArray(v.calculations) &&
              v.calculations.every(
                (c) =>
                  record(c) &&
                  uuid(c.metricId) && typeof c.name === 'string' &&
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
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>本次背景与方法依据</summary>
      {open &&
        (data.error ? (
          <Failure error={data.error} retry={() => setRetry((n) => n + 1)} />
        ) : !data.value ? (
          <Loading />
        ) : (
          <div>
            <p>以下来自实际读取和计算回执，未记录不代表已使用。</p>
            {!data.value.profiles.length && !data.value.calculations.length && (
              <p>本次没有登记背景读取或治理指标计算。</p>
            )}
            {data.value.profiles.map((p) => (
              <p key={p.entryId}>
                背景 {p.title} · v{p.revision}
              </p>
            ))}
            {data.value.calculations.map((c, i) => (
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
    </details>
  );
}
