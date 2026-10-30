import { useContext } from 'react';
import { ArrowRight, SlidersHorizontal, Archive, FileText, Radio, Activity } from 'lucide-react';
import { RequestPending } from '../shared/request-guard';
import { NewsSources } from '../news/NewsSources';
import { ExpressionPreferencesPanel } from '../preferences/ExpressionPreferencesPanel';
import { PlatformStorage } from '../operations/PlatformStorage';
import { MethodWorkbench } from '../methods/MethodWorkbench';
import { adminHref } from './navigation';
import './platform-engine-management.css';

const modules = [
  {
    id: 'versions',
    title: '方法版本',
    icon: SlidersHorizontal,
    category: '功能维护',
    description: '维护固定排序方法，查看候选、版本与验证依据。',
    features: ['方法候选与权重', '同组样例比较', '验证后发布版本'],
    action: '管理方法版本',
    note: '发布后需由企业或空间明确采用',
  },
  {
    id: 'storage',
    title: '存储与备份',
    icon: Archive,
    category: '运行维护',
    description: '查看存储占用、备份记录与恢复验证情况。',
    features: ['存储用量与资料清理', '恢复点与验证记录', '部署操作记录'],
    action: '查看存储与备份',
    note: '备份与恢复由部署工具执行',
  },
  {
    id: 'preferences',
    title: '内容规则',
    icon: FileText,
    category: '内容管理',
    description: '维护总部默认的表达方式与画报选题规则。',
    features: ['内容表达规则', '画报选题规则', '生效规则与修订记录'],
    action: '维护内容规则',
    note: '实际内容遵循对应范围的有效规则',
  },
  {
    id: 'news',
    title: '资讯目录',
    icon: Radio,
    category: '内容管理',
    description: '管理公开网页及订阅来源，维护适用范围。',
    features: ['添加与编辑来源', '行业与地区范围', '启停与最近采集记录'],
    action: '管理资讯来源',
    note: '来源启用与采集成功分别确认',
  },
] as const;

export function PlatformEngineManagement({ hash }: { hash: string }) {
  const pending = useContext(RequestPending);
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  // Preserve links from the original management page and dashboard.
  const originalTab = params.get('tab');
  const tab =
    params.get('detail') === 'storage' || originalTab === 'storage'
      ? 'storage'
      : originalTab === 'methods'
        ? 'versions'
        : originalTab || '';
  const active = modules.find((item) => item.id === tab);
  const href = (id = '') => adminHref('platform', 'capabilities', hash, id ? { tab: id } : {});
  const dashboard = adminHref('platform', 'engine', hash);
  const card = (item: (typeof modules)[number], index: number) => (
    <article className="em-module" key={item.id}>
      <div className="em-module-top">
        <span className="em-icon">
          <item.icon size={20} />
        </span>
        <span className="em-category">{item.category}</span>
        <span className="em-index">0{index + 1}</span>
      </div>
      <h3>{item.title}</h3>
      <p>{item.description}</p>
      <ul>
        {item.features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <footer>
        <a href={href(item.id)}>
          {item.action}
          <ArrowRight size={15} />
        </a>
        <small>{item.note}</small>
      </footer>
    </article>
  );
  const navigation = (
    <nav className="em-navigation" aria-label="引擎管理功能" inert={pending || undefined}>
      <a href={href()} aria-current={!active ? 'page' : undefined}>
        管理概览
      </a>
      {modules.map((item) => (
        <a key={item.id} href={href(item.id)} aria-current={active?.id === item.id ? 'page' : undefined}>
          <item.icon size={16} />
          {item.title}
        </a>
      ))}
    </nav>
  );
  return (
    <div className="platform-engine-management">
      <div className="em-body">
        {navigation}
        <div className="em-content">
          <header className="em-page-heading">
            <div>
              <span className="em-eyebrow">引擎管理 / {active ? active.category : '管理概览'}</span>
              <h2>{active?.title || '维护引擎的方法与内容'}</h2>
              <p>{active?.description || '方法、运行维护与内容设置集中管理，运行状态在仪表盘查看。'}</p>
            </div>
            <a className="em-dashboard-link" href={dashboard} inert={pending || undefined}>
              <Activity size={16} />
              运行仪表盘
              <ArrowRight size={15} />
            </a>
          </header>
          {active ? (
            <div className="em-functional-panel">
              {tab === 'versions' ? (
                <MethodWorkbench embedded />
              ) : tab === 'storage' ? (
                <PlatformStorage hash={hash} embedded />
              ) : tab === 'preferences' ? (
                <ExpressionPreferencesPanel scope="GLOBAL" />
              ) : (
                <NewsSources />
              )}
            </div>
          ) : (
            <>
              <div className="em-card-grid" inert={pending || undefined}>
                {modules.map(card)}
              </div>
              <details className="em-boundary">
                <summary>管理范围与操作说明</summary>
                <p>
                  总部维护已接入的方法、默认内容规则和公开来源。模型凭据、工具安装及原始规则修改由工程维护完成；运行记录在运行看板查看。方法发布不自动代表范围采用或业务效果，管理操作继续遵循原有权限。
                </p>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
