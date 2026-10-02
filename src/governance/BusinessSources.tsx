import { useContext, useEffect, useState } from 'react';
import { Database, FileUp, MessageSquare, RefreshCw } from 'lucide-react';
import { identityClient, useSession } from '../identity/session';
import { Button, Empty, Field } from '../shared/ui';
import { Failure, Loading, useRemote } from '../shared/admin';
import { RequestPending } from '../shared/request-guard';
import { SourcePanel } from '../source/SourcePanel';
import './work-configuration.css';
type Props = {
  tenant: string;
  verification?: number;
  onOpenLibrary?: (workspace: string) => void;
  onOpenConversation?: () => void;
};
export function BusinessSources(props: Props) {
  return <ScopedSources key={props.tenant} {...props} />;
}
function ScopedSources({ tenant, verification = 0, onOpenLibrary, onOpenConversation }: Props) {
  const { session } = useSession(),
    pending = useContext(RequestPending);
  const [selected, setSelected] = useState(
      () => new URLSearchParams(location.hash.slice(1)).get('scope') || '',
    ),
    [opened, setOpened] = useState(() => new URLSearchParams(location.hash.slice(1)).has('source')),
    [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((x) => x + 1);
  useEffect(() => {
    const focus = () => {
      if (!pending && !opened) refresh();
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [pending, opened]);
  const remote = useRemote(
    (signal) => identityClient.context(tenant, signal),
    [tenant, verification, attempt, session.identity],
  );
  const spaces = remote.value?.workspaces.filter((w) => w.kind === 'SHARED') ?? [],
    active = selected ? spaces.find((w) => w.id === selected) : spaces[0];
  return (
    <section className="access-panel business-configuration" aria-label="企业数据来源">
      <header className="configuration-heading">
        <div>
          <p className="configuration-kicker">
            <Database size={16} /> 数据与能力
          </p>
          <h2>数据来源</h2>
          <p className="muted">
            在企业管理端维护当前获权共享空间的来源、负责人和更新周期；资料仍保存在对应空间。
          </p>
        </div>
        <Button icon={RefreshCw} disabled={pending} onClick={refresh}>
          刷新获权空间
        </Button>
      </header>
      {remote.error ? (
        <Failure error={remote.error} retry={refresh} />
      ) : !remote.value ? (
        <Loading />
      ) : active ? (
        <>
          <div className="configuration-scope">
            <Field label="来源所属空间">
              <select
                aria-label="来源所属空间"
                disabled={pending}
                value={active.id}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setOpened(false);
                }}
              >
                {spaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button variant="primary" disabled={pending} onClick={() => setOpened(true)}>
              管理该空间的数据来源
            </Button>
          </div>
          <div className="configuration-grid">
            <article className="configuration-card">
              <h3>无需接口也能开始</h3>
              <p>
                先上传已有表格或文档。需要持续更新时，再登记来源、负责人、周期和预计覆盖日期，并用确切资料版本补交。
              </p>
              {onOpenLibrary ? (
                <Button icon={FileUp} disabled={pending} onClick={() => onOpenLibrary(active.id)}>
                  打开空间资料库
                </Button>
              ) : (
                <a
                  className="button secondary"
                  aria-disabled={pending}
                  href={
                    pending
                      ? undefined
                      : `/workspace/#${new URLSearchParams({ tenant, view: 'library', scope: active.id })}`
                  }
                >
                  打开空间资料库
                </a>
              )}
            </article>
            <article className="configuration-card">
              <h3>接收与覆盖分别核对</h3>
              <p>
                文件已上传或已解析，不等于本期业务资料完整。来源详情会区分缺口、到期和人工覆盖声明；维护资格仍由服务端逐项检查。
              </p>
              <p className="muted">此入口只管理人工持续来源。自动连接业务系统需已有接口与独立接入能力。</p>
            </article>
          </div>
          {opened && (
            <SourcePanel
              key={active.id}
              tenant={tenant}
              workspace={active.id}
              workspaceName={active.name}
              verification={`${verification}:${attempt}`}
              close={() => {
                if (!pending) setOpened(false);
              }}
            />
          )}
        </>
      ) : selected && spaces.length > 0 ? (
        <Empty
          icon={Database}
          title="原工作空间当前不可用"
          text="来源页面未切换到其他空间。可返回原工作，或明确选择另一个获权空间。"
        >
          <Button
            onClick={() => {
              setSelected(spaces[0].id);
              setOpened(false);
            }}
          >
            查看其他获权空间
          </Button>
        </Empty>
      ) : (
        <Empty
          icon={Database}
          title="当前没有获权的共享空间"
          text="企业管理身份不会自动开放其他空间。你仍可在个人工作空间上传已有资料或发起普通会话。"
        />
      )}
      <aside className="configuration-note">
        <strong>零来源不阻止普通工作</strong>
        <p>
          可先整理背景、准备模板或处理明确上传的文件。没有企业证据时，不生成已核实经营异常或“数据完整”的结论。
        </p>
        {onOpenConversation ? (
          <Button icon={MessageSquare} disabled={pending} onClick={onOpenConversation}>
            回到我的 AI 会话
          </Button>
        ) : (
          <a
            className="button secondary"
            aria-disabled={pending}
            href={
              pending ? undefined : `/workspace/#${new URLSearchParams({ tenant, view: 'conversations' })}`
            }
          >
            回到我的 AI 会话
          </a>
        )}
      </aside>
    </section>
  );
}
