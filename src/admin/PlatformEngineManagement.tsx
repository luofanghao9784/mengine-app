import { NewsSources } from '../news/NewsSources';
import { ExpressionPreferencesPanel } from '../preferences/ExpressionPreferencesPanel';
import { PlatformStorage } from '../operations/PlatformStorage';
import { useContext } from 'react';
import { ArrowRight, SlidersHorizontal } from 'lucide-react';
import { RequestPending } from '../shared/request-guard';
import { Badge } from '../shared/ui';
import { MethodWorkbench } from '../methods/MethodWorkbench';
import { adminHref } from './navigation';
import './platform-engine-management.css';

export function PlatformEngineManagement({ hash }: { hash: string }) {
  const pending = useContext(RequestPending);
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const storage = params.get('tab') === 'storage' || params.get('detail') === 'storage';
  const preferences = params.get('tab') === 'preferences';
  const news = params.get('tab') === 'news';
  const versions = ['versions', 'methods'].includes(params.get('tab') || '');
  const versionHref = adminHref('platform', 'capabilities', hash, { tab: 'versions' });
  return (
    <div className="platform-engine-management">
      <nav className="platform-engine-tabs" aria-label="引擎管理板块" inert={pending || undefined}>
        <a
          href={adminHref('platform', 'capabilities', hash)}
          aria-current={!versions && !storage && !preferences && !news ? 'page' : undefined}
        >
          能力与规则
        </a>
        <a href={versionHref} aria-current={versions ? 'page' : undefined}>
          版本与更新
        </a>
        <a
          href={adminHref('platform', 'capabilities', hash, { tab: 'storage' })}
          aria-current={storage ? 'page' : undefined}
        >
          存储与备份
        </a>
        <a
          href={adminHref('platform', 'capabilities', hash, { tab: 'preferences' })}
          aria-current={preferences ? 'page' : undefined}
        >
          内容偏好
        </a>
        <a
          href={adminHref('platform', 'capabilities', hash, { tab: 'news' })}
          aria-current={news ? 'page' : undefined}
        >
          资讯来源
        </a>
      </nav>
      {news ? (
        <NewsSources />
      ) : preferences ? (
        <ExpressionPreferencesPanel scope="GLOBAL" />
      ) : storage ? (
        <PlatformStorage hash={hash} embedded />
      ) : versions ? (
        <MethodWorkbench embedded />
      ) : (
        <div className="platform-engine-capabilities">
          <section className="platform-capability-section" aria-labelledby="ranking-capability-title">
            <div className="platform-capability-heading">
              <h2 id="ranking-capability-title">
                <SlidersHorizontal size={19} aria-hidden="true" />
                固定排序方法
              </h2>
              <Badge>已接入版本管理</Badge>
            </div>
            <p>按相关度、新鲜度与业务重要度排序，权重和验证依据随方法版本保存。</p>
            <dl className="platform-capability-facts">
              <div>
                <dt>能力范围</dt>
                <dd>RANKING_V1 · 固定排序特征</dd>
              </div>
              <div>
                <dt>管理内容</dt>
                <dd>方法候选、版本内容与排序验证记录</dd>
              </div>
              <div>
                <dt>实际采用</dt>
                <dd>由各企业或空间的有效采用记录确认</dd>
              </div>
            </dl>
            <a className="platform-capability-link" href={versionHref}>
              查看方法版本与验证依据
              <ArrowRight size={15} aria-hidden="true" />
            </a>
            <details className="platform-capability-details">
              <summary>适用边界</summary>
              <p>
                当前排序验证使用合成样例。版本发布、范围采用和业务效果分别记录；排序权重不改变资料权限与可见范围。
              </p>
            </details>
          </section>
          <section className="platform-capability-section" aria-labelledby="capability-coverage-title">
            <h2 id="capability-coverage-title">模型、工具与主规则</h2>
            <dl className="platform-capability-facts">
              <div>
                <dt>模型与连接状态</dt>
                <dd>此页面尚未接入状态展示</dd>
              </div>
              <div>
                <dt>工具部署与可用状态</dt>
                <dd>此页面尚未接入状态展示</dd>
              </div>
              <div>
                <dt>主规则内容与有效版本</dt>
                <dd>此页面尚未接入版本展示</dd>
              </div>
            </dl>
            <p className="muted">
              现有运行记录可在引擎仪表盘中查看。未接入展示的能力不据此判断为正常或停用。
            </p>
            <a className="platform-capability-link" href={adminHref('platform', 'engine', hash)}>
              查看引擎仪表盘
              <ArrowRight size={15} aria-hidden="true" />
            </a>
          </section>
          <details className="platform-capability-maintenance">
            <summary>工程维护与总台管理的分工</summary>
            <p>
              模型凭据、工具安装、代码与原始规则修改、候选部署和兼容检查由工程维护完成。总台按已接入的版本记录查看内容及验证依据，实际采用遵守对应范围的资格与条件。
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
