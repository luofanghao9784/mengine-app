import { useState } from 'react';
import { companySourceClient } from './company-source-client';
import { companyFields } from './company-client';
import { Failure, Loading, useRemote } from '../shared/admin';
import { useSession } from '../identity/session';
import { Button } from '../shared/ui';

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
  const data = useRemote(
    (signal) => companySourceClient.knowledge(tenant, signal),
    [tenant, revision, session.identity],
  );
  if (data.error) return <Failure error={data.error} retry={() => refresh((n) => n + 1)} />;
  if (!data.value) return <Loading />;
  const items = data.value.items.filter((x) => !entryId || x.sourceEntryId === entryId);
  return (
    <section aria-label="企业背景知识" className="background-knowledge">
      <h3>企业背景知识</h3>
      <p>原背景已整理为可引用的结构化知识。这里没有生成 AI 分析文章，也不代表检索索引已完成。</p>
      {!items.length && <p role="status">当前没有可读取的背景知识。</p>}
      {items.map((k) => (
        <article key={k.id}>
          <h4>{k.title}</h4>
          <p>
            {companyFields[k.field]} · v{k.revision} ·{' '}
            {k.origin === 'HUMAN' ? '人工维护' : 'AI 整理，含义需核实'}
          </p>
          {k.content && <p>{k.content}</p>}
          <p role="status">结构化引用已就绪；来源更新后读取新版本。</p>
          <details>
            <summary>来源依据与关联方法</summary>
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
      <Button variant="ghost" onClick={() => { refresh((n) => n + 1); onRefresh?.(); }}>
        刷新背景知识
      </Button>
    </section>
  );
}
