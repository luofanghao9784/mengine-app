import { useEffect, useState } from 'react';
import { IdentityError } from '../identity/client';
import { Badge, Button } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { generalExperienceClient as api } from './general-client';
import type { GeneralMethod } from '../../contracts/public-api/general-experience';

const stamp = (v: string) => new Date(v).toLocaleString('zh-CN', { hour12: false });
export function GeneralMethodBody({ method }: { method: GeneralMethod }) {
  return (
    <>
      <h2>{method.title}</h2>
      <p>{method.summary}</p>
      <div className="experience-management-tags">
        {method.tags.map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
      </div>
      <h3>方法步骤</h3>
      <ol>
        {method.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <h3>适用条件</h3>
      <ul>
        {method.applicable.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      <h3>限制</h3>
      <ul>
        {method.excluded.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </>
  );
}
export function GeneralExperienceHistory({
  tenant,
  entry,
  current,
  disabled,
  denied,
}: {
  tenant?: string;
  entry: string;
  current: string;
  disabled: boolean;
  denied: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="general-experience-history" aria-label="通用经验版本历史">
      <Button variant="ghost" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '收起版本历史' : '查看版本历史'}
      </Button>
      {open && (
        <History tenant={tenant} entry={entry} current={current} disabled={disabled} denied={denied} />
      )}
    </section>
  );
}
function History({
  tenant,
  entry,
  current,
  disabled,
  denied,
}: {
  tenant?: string;
  entry: string;
  current: string;
  disabled: boolean;
  denied: (error: unknown) => void;
}) {
  const [page, setPage] = useState(0),
    [attempt, refresh] = useState(0),
    [selected, select] = useState<string | null>(null);
  const data = useRemote(
    (signal) => api.versions(tenant, entry, current, page * 20, signal),
    [tenant, entry, current, page, attempt],
  );
  useEffect(() => {
    if (data.error instanceof IdentityError && [401, 403, 404].includes(data.error.status))
      denied(data.error);
  }, [data.error, denied]);
  return (
    <>
      <p className="muted">仅查看仍有有效来源的已发布版本。查看历史不会改变当前版本或引擎引用。</p>
      {data.error ? (
        <Failure error={data.error} retry={() => refresh((n) => n + 1)} />
      ) : !data.value ? (
        <Loading />
      ) : (
        <>
          <fieldset className="general-experience-control-group" disabled={disabled}>
            <div className="general-experience-history-list">
              {data.value.items.map((v) => (
                <Button
                  key={v.versionId}
                  variant={selected === v.versionId ? 'primary' : 'ghost'}
                  aria-pressed={selected === v.versionId}
                  onClick={() => select(v.versionId)}
                >
                  v{v.number}
                  {v.versionId === current ? ' · 当前版本' : ' · 历史版本'} · {stamp(v.createdAt)}
                </Button>
              ))}
            </div>
            <Pager
              page={page}
              next={data.value.hasMore}
              onPage={(p) => {
                if (!disabled) {
                  setPage(p);
                  select(null);
                }
              }}
            />
          </fieldset>
          {selected && (
            <HistoricalContent
              key={selected}
              tenant={tenant}
              entry={entry}
              current={current}
              version={selected}
              disabled={disabled}
              denied={denied}
            />
          )}
        </>
      )}
    </>
  );
}
function HistoricalContent({
  tenant,
  entry,
  current,
  version,
  disabled,
  denied,
}: {
  tenant?: string;
  entry: string;
  current: string;
  version: string;
  disabled: boolean;
  denied: (error: unknown) => void;
}) {
  const [attempt, refresh] = useState(0);
  const data = useRemote(
    (signal) => api.historical(tenant, entry, current, version, signal),
    [tenant, entry, current, version, attempt],
  );
  useEffect(() => {
    if (data.error instanceof IdentityError && [401, 403].includes(data.error.status)) denied(data.error);
  }, [data.error, denied]);
  if (data.error) return <Failure error={data.error} retry={() => refresh((n) => n + 1)} />;
  if (!data.value) return <Loading />;
  const d = data.value;
  return (
    <article className="general-experience-history-content" aria-label={`版本 v${d.number} 只读内容`}>
      <Badge>{version === current ? '当前版本 · 只读查看' : '历史版本 · 只读查看'}</Badge>
      <p className="muted">
        v{d.number} · 发布时间：{stamp(d.createdAt)}
      </p>
      <GeneralMethodBody method={d.method} />
      <GeneralExperienceActivity
        tenant={tenant}
        entry={entry}
        current={current}
        version={version}
        disabled={disabled}
        denied={denied}
      />
      <p className="muted">
        {d.method.basis === 'OBSERVED_EXECUTION' ? '提炼依据为实际执行记录。' : '提炼依据为反馈纠正。'}{' '}
        自动核验通过不代表已证明所有业务效果。
      </p>
    </article>
  );
}

export function GeneralExperienceActivity({
  tenant,
  entry,
  current,
  version,
  disabled,
  denied,
}: {
  tenant?: string;
  entry: string;
  current: string;
  version: string;
  disabled: boolean;
  denied: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="本版本使用情况" className="general-experience-history">
      <Button variant="ghost" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '收起使用情况' : '查看使用情况'}
      </Button>
      {open && <Activity tenant={tenant} entry={entry} current={current} version={version} denied={denied} />}
    </section>
  );
}
function Activity({
  tenant,
  entry,
  current,
  version,
  denied,
}: {
  tenant?: string;
  entry: string;
  current: string;
  version: string;
  denied: (error: unknown) => void;
}) {
  const [attempt, refresh] = useState(0);
  const data = useRemote(
    (signal) => api.activity(tenant, entry, current, version, signal),
    [tenant, entry, current, version, attempt],
  );
  useEffect(() => {
    if (data.error instanceof IdentityError && [401, 403, 404].includes(data.error.status))
      denied(data.error);
  }, [data.error, denied]);
  if (data.error) return <Failure error={data.error} retry={() => refresh((n) => n + 1)} />;
  if (!data.value) return <Loading />;
  const d = data.value;
  return (
    <>
      <p className="muted">
        {tenant ? '当前有权管理的共享空间' : '全平台匿名汇总'} · 仅统计本版本仍保留的真实执行记录。
      </p>
      <dl className="general-experience-activity">
        {(
          [
            ['被参考', d.referencedAttempts],
            ['完整读取', d.fullyReadAttempts],
            ['适用判断', d.assessedAttempts],
            ['记录采用', d.adoptedAttempts],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        每个任务尝试计一次，重复读取或记录不会重复计数。被参考包含检索命中及直接读取；采用来自模型的直接或调整后采用记录，不等于实际业务执行成功。验证模式不计入。
      </p>
      <p className="muted">
        业务效果：尚未确认。记录清理或权限变化可能影响统计。更新于 {stamp(d.checkedAt)}。
      </p>
    </>
  );
}
