import { versionLabel } from '../admin/display-labels';
import { useState } from 'react';
import { materialClient as api } from './client';
import { Failure, Loading, useRemote } from '../shared/admin';
import { processingStatusLabel } from './Knowledge';

export function MaterialPipeline({
  tenant,
  workspace,
  material,
}: {
  tenant: string;
  workspace: string;
  material: string;
}) {
  const [revision, refresh] = useState(0);
  const data = useRemote(
    (signal) => api.pipeline(tenant, workspace, material, signal),
    [tenant, workspace, material, revision],
  );
  const s = data.value;
  return (
    <section aria-label="资料处理四阶段" className="mat-pipeline">
      <h3>
        当前版本处理阶段{' '}
        <button type="button" onClick={() => refresh((n) => n + 1)}>
          刷新阶段
        </button>
      </h3>
      {data.error ? (
        <Failure error={data.error} retry={() => refresh((n) => n + 1)} />
      ) : !s ? (
        <Loading />
      ) : (
        <>
          <p className="perm-note">
            以下为当前最新 {versionLabel(s.version)} 的独立状态；资料阅读、规则检查和 Wiki 发布分别执行。
          </p>
          <ol className="material-pipeline">
            <li>
              <strong>数据接入</strong>
              <span>原件已保存</span>
              <small>{new Date(s.receivedAt).toLocaleString('zh-CN')}</small>
            </li>
            <li>
              <strong>内容解析</strong>
              <span>{processingStatusLabel[s.parsing] || '尚未解析'}</span>
              <small>解析完成不代表事实核验</small>
            </li>
            <li>
              <strong>治理校验</strong>
              <span>
                {s.governance === 'NOT_CHECKED'
                  ? '尚未检查'
                  : s.governance === 'NO_TEXT'
                    ? '缺少可检查正文'
                    : s.issues
                      ? `${s.issues} 项需关注`
                      : '规则检查无异常'}
              </span>
              <small>检查结果不自动改变资料权限</small>
            </li>
            <li>
              <strong>知识发布</strong>
              <span>
                {
                  {
                    NOT_PUBLISHED: '尚未发布 Wiki',
                    PUBLISHED: '当前 Wiki 已发布',
                    ARCHIVED: 'Wiki 已下架',
                    STALE: 'Wiki 来源已变化',
                  }[s.publication]
                }
              </span>
              <small>维护者确认后共享，沿来源权限</small>
            </li>
          </ol>
        </>
      )}
    </section>
  );
}
