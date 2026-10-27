import { useState } from 'react';
import { companySourceClient } from './company-source-client';
import { companyFields } from './company-client';
import { Failure, Loading, useRemote } from '../shared/admin';
import { useSession } from '../identity/session';
import { Button } from '../shared/ui';
import './background-reading.css';

export function BackgroundKnowledge({
  tenant,
  entryId,
  onSource,
  onRefresh,
}: {
  tenant: string;
  entryId?: string;
  onSource?: () => void;
  onRefresh?: () => void;
}) {
  const { session } = useSession();
  const [revision, refresh] = useState(0);
  const [field, setField] = useState('all');
  const data = useRemote(
    (signal) => companySourceClient.knowledge(tenant, signal),
    [tenant, revision, session.identity],
  );
  if (data.error) return <Failure error={data.error} retry={() => refresh((n) => n + 1)} />;
  if (!data.value) return <Loading />;
  const items = data.value.items.filter((x) => !entryId || x.sourceEntryId === entryId);
  return (
    <section aria-label="企业背景参考" className="background-knowledge">
      <h3>企业背景参考</h3>
      <p className="background-reading-intro">治理上下文，未计入已发布知识 · {items.length} 项背景</p>
      <div className="background-reading-filters" role="group" aria-label="背景分类">
        <button type="button" aria-pressed={field === 'all'} onClick={() => setField('all')}>全部 {items.length}</button>
        {Object.entries(companyFields).filter(([key]) => items.some(k => k.field === key)).map(([key, label]) =>
          <button type="button" key={key} aria-pressed={field === key} onClick={() => setField(key)}>{label} {items.filter(k => k.field === key).length}</button>)}
      </div>
      {!items.length && <p role="status">当前没有可读取的背景参考。</p>}
      {Object.entries(companyFields).filter(([key]) => (field === 'all' || field === key) && items.some(k => k.field === key)).map(([key, label]) => (
        <section className="background-reading-group" key={key} aria-label={label}>
          <h4>{label}<span>{items.filter(k => k.field === key).length} 项</span></h4>
          {items.filter(k => k.field === key).map((k) => (
        <article key={k.id}>
          <h5>{k.title}</h5>
          <p className="background-entry-meta">
            v{k.revision} ·{' '}
            {k.origin === 'HUMAN' ? '人工维护' : 'AI 整理，含义需核实'}
          </p>
          {k.content && <p className="background-entry-content">{k.content}</p>}
          <details>
            <summary>来源与关联指标{k.methods.length ? ` · ${k.methods.length} 项` : ''}</summary>
            <p>结构化引用已就绪；来源更新后读取新版本。引用就绪不代表 AI 分析或检索索引已完成。</p>
            <p>
              背景条目：{k.sourceEntryId}
              <br />
              引用版本：{k.sourceVersionId}
            </p>
            {!k.methods.length ? (
              <p>当前可见范围内没有关联指标。</p>
            ) : (
              k.methods.map((m) => (
                <p key={m.id}>
                  {m.name} · v{m.version} ·{' '}
                  {m.status === 'REFERENCE_CURRENT' ? '背景依据有效' : '背景已变化，需核对并发布新方法版本'}
                </p>
              ))
            )}
            {k.methods.length === 21 && <p>仅展示最近关联方法，请到指标目录查看完整列表。</p>}
            {onSource && (
              <Button variant="ghost" onClick={onSource}>
                返回企业背景维护
              </Button>
            )}
          </details>
        </article>
          ))}
        </section>
      ))}
      <Button variant="ghost" onClick={() => { refresh((n) => n + 1); onRefresh?.(); }}>
        刷新背景参考
      </Button>
    </section>
  );
}
