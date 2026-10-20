import { BackgroundKnowledge } from './BackgroundKnowledge';
import { useState } from 'react';
import { companySourceClient } from './company-source-client';
import { companyFields } from './company-client';
import { Failure, Loading, useRemote } from '../shared/admin';
import { useSession } from '../identity/session';
import { adminHref } from '../admin/navigation';
import { Button } from '../shared/ui';

export function CompanyBackgroundSource({
  tenant,
  hash,
  tagId,
  onMaintain,
}: {
  tenant: string;
  hash?: string;
  tagId?: string;
  onMaintain?: () => void;
}) {
  const { session } = useSession();
  const [attempt, refresh] = useState(0);
  const data = useRemote(
    (signal) => companySourceClient.get(tenant, signal),
    [tenant, attempt, session.identity],
  );
  const source = data.value;
  const item = tagId ? source?.entries.find((e) => e.id === tagId) : null;
  return (
    <section className="admin-section background-source" aria-label={tagId ? '背景来源与知识使用' : '企业背景内部来源'}>
      <h3>{tagId ? '背景来源与知识使用' : '企业背景 · 内部来源'}</h3>
      {data.error ? (
        <Failure error={data.error} retry={() => refresh((n) => n + 1)} />
      ) : !source ? (
        <Loading />
      ) : (
        <>
          {tagId ? (
            item ? (
              <p>
                当前可用版本 v{item.revision} · {companyFields[item.field]} · {item.label}
              </p>
            ) : (
              <p>当前条目已不在可读取来源中，请关闭详情并刷新企业背景。</p>
            )
          ) : (
            <>
              <p>
                {source.state === 'AVAILABLE'
                  ? `可读取 ${source.entries.length} 条背景`
                  : '当前没有可读取的背景条目'}{' '}
                · 按当前身份权限展示
              </p>
              <details>
                <summary>查看来源版本与条目</summary>
                <p>直接读取原背景，无需导入或复制。修改后下次读取生效；关联指标仍需按版本核对。</p>
                <p>
                  当前可读内容版本：<code style={{ overflowWrap: 'anywhere' }}>{source.version}</code>
                </p>
                <ul>
                  {source.entries.map((e) => (
                    <li key={e.id}>
                      {companyFields[e.field]} · {e.label} · v{e.revision}
                    </li>
                  ))}
                </ul>
              </details>
              {onMaintain ? (
                <Button variant="ghost" onClick={onMaintain}>
                  维护企业背景 →
                </Button>
              ) : (
                <a href={adminHref('tenant', 'company', hash || '')}>维护企业背景 →</a>
              )}
            </>
          )}
          {(!tagId || item) &&
            (source.knowledgeIntegration === 'REFERENCE_READY' ? (
              <BackgroundKnowledge key={source.version} tenant={tenant} entryId={tagId} onSource={onMaintain} />
            ) : (
              <p role="status">知识使用情况待联调：当前后端尚未启用背景引用接口，不能据此判断是否已有知识引用。</p>
            ))}
          <Button variant="ghost" onClick={() => refresh((n) => n + 1)}>
            刷新来源状态
          </Button>
        </>
      )}
    </section>
  );
}
