import { useContext, useEffect, useState } from 'react';
import { BookOpen, Clock3, Layers3, RefreshCw, Settings2 } from 'lucide-react';
import { identityClient, useSession } from '../identity/session';
import { Button, Field } from '../shared/ui';
import { Failure, Loading, useRemote } from '../shared/admin';
import { RequestPending } from '../shared/request-guard';
import { createHttpSystemClient, SystemClientError } from '../data/systemClient';
import { methodClient } from '../methods/client';
import { runtimePresentation, effectiveMethodPresentation } from './work-configuration';
import './work-configuration.css';
const runtimeClient = createHttpSystemClient();
type Props = {
  tenant: string;
  verification?: number;
  onOpenMethods?: () => void;
  onOpenProfiles?: () => void;
  onOpenSources?: () => void;
  onOpenOperations?: () => void;
  onOpenPlans?: () => void;
};
export function WorkConfiguration(props: Props) {
  return <Configuration key={props.tenant} {...props} />;
}
function Configuration({
  tenant,
  verification = 0,
  onOpenMethods,
  onOpenProfiles,
  onOpenSources,
  onOpenOperations,
  onOpenPlans,
}: Props) {
  const { session } = useSession(),
    pending = useContext(RequestPending);
  const [attempt, setAttempt] = useState(0),
    [workspace, setWorkspace] = useState<string | null>(null);
  const refresh = () => setAttempt((x) => x + 1);
  useEffect(() => {
    const focus = () => {
      if (!pending) refresh();
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [pending]);
  const context = useRemote(
    (signal) => identityClient.context(tenant, signal),
    [tenant, attempt, verification, session.identity],
  );
  const spaces = context.value?.workspaces.filter((w) => w.kind === 'SHARED') ?? [];
  const selected = workspace && spaces.some((w) => w.id === workspace) ? workspace : null;
  const runtime = useRemote(
    (signal) => runtimeClient.getInfo(signal),
    [tenant, attempt, verification, session.identity],
  );
  const method = useRemote(
    (signal) => (context.value ? methodClient.selection(tenant, selected, signal) : Promise.resolve(null)),
    [tenant, selected, context.value, attempt, verification, session.identity],
  );
  if (context.error) return <Failure error={context.error} retry={refresh} />;
  if (!context.value) return <Loading />;
  const engine = runtime.value ? runtimePresentation(runtime.value) : null,
    effective = method.value ? effectiveMethodPresentation(method.value) : null;
  return (
    <section className="access-panel business-configuration" aria-label="当前 AI 工作配置">
      <header className="configuration-heading">
        <div>
          <p className="configuration-kicker">
            <Settings2 size={16} /> 当前生效情况
          </p>
          <h2>AI 工作配置</h2>
          <p className="muted">
            核对当前实际采用的能力与方法，按职责进入原模块调整。查看页面不会启用计划或改变权限。
          </p>
        </div>
        <Button icon={RefreshCw} disabled={pending} onClick={refresh}>
          重新核对配置
        </Button>
      </header>
      <div className="configuration-grid">
        <article className="configuration-card" aria-label="引擎运行状态">
          <h3>引擎运行状态</h3>
          {runtime.error ? (
            <>
              <p role="status">
                {runtime.error instanceof SystemClientError
                  ? runtime.error.message
                  : '暂时无法核对引擎响应。'}
              </p>
              <p className="muted">当前能力未知，未自动使用演示状态代替。</p>
            </>
          ) : !engine ? (
            <Loading />
          ) : (
            <>
              <strong className="configuration-value">{engine.title}</strong>
              <p>{engine.detail}</p>
              <dl className="configuration-facts">
                <div>
                  <dt>依据</dt>
                  <dd>{engine.source}</dd>
                </div>
                <div>
                  <dt>运行版本</dt>
                  <dd>{engine.engineVersion}</dd>
                </div>
                <div>
                  <dt>本次报告的能力</dt>
                  <dd>{engine.capabilities.join('、') || '未报告可执行能力'}</dd>
                </div>
              </dl>
            </>
          )}
        </article>
        <article className="configuration-card">
          <h3>主模型基础规则</h3>
          <strong className="configuration-value">随引擎发布维护的共用规则</strong>
          <p>
            当前实现由引擎代码维护轻量规则，指导模型按需检索、区分事实与偏好、核对来源和实际回执。企业无需复制或编辑整份规则文档。
          </p>
          <p className="muted">
            当前状态接口没有报告独立的主规则版本，不能据前端代码推断运行中的确切规则文件。这里不提供尚未接入的在线规则编辑。
          </p>
          <p className="configuration-source">
            来源：当前已交付的引擎规则机制说明；运行能力以左侧服务响应为准。
          </p>
        </article>
      </div>
      <section className="configuration-section" aria-label="当前推荐方法">
        <header>
          <div>
            <h3>智能画报推荐方法</h3>
            <p className="muted">此配置控制候选排序，不是主模型的执行规则，也不扩大可见内容。</p>
          </div>
          <Field label="查看方法生效范围">
            <select
              aria-label="查看方法生效范围"
              disabled={pending}
              value={selected ?? ''}
              onChange={(e) => setWorkspace(e.target.value || null)}
            >
              <option value="">企业默认</option>
              {spaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        </header>
        {method.error ? (
          <Failure error={method.error} retry={refresh} />
        ) : !effective ? (
          <Loading />
        ) : (
          <article className="configuration-card">
            <strong className="configuration-value">{effective.source}</strong>
            <div className="configuration-weights">
              <div>
                <span>相关度</span>
                <strong>{effective.configuration.relevanceWeight}</strong>
              </div>
              <div>
                <span>新鲜度</span>
                <strong>{effective.configuration.recencyWeight}</strong>
              </div>
              <div>
                <span>业务重要度</span>
                <strong>{effective.configuration.importanceWeight}</strong>
              </div>
            </div>
            <p>权重归一化后使用。同分按创建时间及稳定编号排序；权限、用户隐藏和可见范围另行约束。</p>
            {effective.stoppedLocalAdoption && (
              <p className="configuration-note">
                当前范围已停止原先的明确采用，上面显示的是实际回退后的有效配置。
              </p>
            )}
            <p className="muted">当前比较依据为合成排序样例，不能据此宣称业务质量已经提升。</p>
            <details>
              <summary>有效配置的版本依据</summary>
              <dl className="configuration-facts">
                <div>
                  <dt>生效来源</dt>
                  <dd>{effective.source}</dd>
                </div>
                <div>
                  <dt>确切方法版本</dt>
                  <dd>{effective.versionId ?? '内建默认，无单独采用版本'}</dd>
                </div>
                <div>
                  <dt>有效采用修订</dt>
                  <dd>{effective.adoptionRevision}</dd>
                </div>
                <div>
                  <dt>配置指纹</dt>
                  <dd>{effective.configurationSha}</dd>
                </div>
              </dl>
            </details>
            {onOpenMethods && (
              <Button disabled={pending} onClick={onOpenMethods}>
                {effective.canAdopt ? '进入方法采用与回退' : '查看方法与版本依据'}
              </Button>
            )}
          </article>
        )}
      </section>
      <div className="configuration-grid">
        <article className="configuration-card">
          <h3>
            <BookOpen size={18} /> 背景、目标与偏好
          </h3>
          <p>
            企业、空间与本人的档案分别保存。事实、推断、目标及表达偏好按用途装配；档案文字不会自行授权，也不代表持续任务已经安排。
          </p>
          <div className="configuration-actions">
            {onOpenProfiles && (
              <Button disabled={pending} onClick={onOpenProfiles}>
                维护获权档案
              </Button>
            )}
            <a
              className="button secondary"
              aria-disabled={pending}
              href={pending ? undefined : `/workspace/#${new URLSearchParams({ tenant, view: 'profiles' })}`}
            >
              我的档案与偏好
            </a>
          </div>
        </article>
        <article className="configuration-card">
          <h3>
            <Clock3 size={18} /> 主动与持续工作
          </h3>
          <p>
            普通会话可以直接开始。只有明确保存的本人计划才持续运行；没有企业级“代管全员私人计划”入口，也不会因开通企业就扫描所有私人资料。
          </p>
          {onOpenPlans ? (
            <Button disabled={pending} onClick={onOpenPlans}>
              查看我的持续计划
            </Button>
          ) : (
            <a
              className="button secondary"
              aria-disabled={pending}
              href={pending ? undefined : `/workspace/#${new URLSearchParams({ tenant, view: 'plans' })}`}
            >
              查看我的持续计划
            </a>
          )}
        </article>
        <article className="configuration-card">
          <h3>
            <Layers3 size={18} /> 资料与能力范围
          </h3>
          <p>
            读取范围由当前空间与内容授权确定。持续来源的覆盖声明、文件解析和业务完整性分开核对；新空间不会自动加入原来的持续计划。
          </p>
          {onOpenSources && (
            <Button disabled={pending} onClick={onOpenSources}>
              管理获权数据来源
            </Button>
          )}
        </article>
        <article className="configuration-card">
          <h3>成果与运行依据</h3>
          <p>
            首版交付与提醒限站内。共享发布单独检查许可；使用量、未知回执、等待和失败由运行记录反映，技术上限不等于费用预算。
          </p>
          {onOpenOperations && (
            <Button disabled={pending} onClick={onOpenOperations}>
              查看获准运行概览
            </Button>
          )}
        </article>
      </div>
    </section>
  );
}
