import { useEffect, useState } from 'react';
import { ArrowLeft, FileText, FolderOpen, RefreshCw, Recycle } from 'lucide-react';
import type { MaterialProcessingPage } from '../../contracts/public-api/knowledge';
import type { TenantContext } from '../../contracts/public-api/identity';
import { identityClient, useSession } from '../identity/session';
import { uuid } from '../identity/client';
import { adminHref } from '../admin/navigation';
import { Badge, Button, Empty, Field, Modal, PageActions } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
import { pageState, textState, useViewState } from '../shared/useViewState';
import { requestNavigationLocked } from '../shared/request-guard';
import { MaterialMaintenance } from '../lifecycle/MaterialMaintenance';
import { AnalysisPanel, processingStatusLabel } from './Knowledge';
import { DocumentDialog, LiveLibrary } from './Library';
import { materialClient } from './client';
import { knowledgeClient } from './knowledge-client';
import './processing.css';
import { MaterialGovernance } from './MaterialGovernance';
const states: Record<MaterialProcessingPage['state'], string> = {
  ALL: '全部状态',
  READY: '已解析',
  PROCESSING: '处理中',
  ATTENTION: '需留意',
  NOT_STARTED: '尚未解析',
};
const stateValue = (v: unknown): v is MaterialProcessingPage['state'] => typeof v === 'string' && v in states;
const date = (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '暂无记录');
type Selection = { id: string; workspaceId: string; versionId: string };
const selectionValue = (v: unknown): v is Selection | null =>
  v === null ||
  (!!v &&
    typeof v === 'object' &&
    'id' in v &&
    'workspaceId' in v &&
    'versionId' in v &&
    uuid(v.id) &&
    uuid(v.workspaceId) &&
    uuid(v.versionId));
export function TenantMaterials({ tenant, hash }: { tenant: string; hash: string }) {
  const { session } = useSession();
  const [attempt, setAttempt] = useState(0);
  const params = new URLSearchParams(hash.slice(1));
  const files =
    params.get('section') === 'files' || (!params.has('admin') && params.get('view') === 'library');
  const governance = !files && params.get('section') !== 'processing';
  const [recycle, setRecycle] = useState(params.get('detail') === 'content-lifecycle');
  const context = useRemote(
    (signal) => identityClient.context(tenant, signal),
    [tenant, attempt, session.identity],
  );
  const href = (extra: Record<string, string> = {}) => adminHref('tenant', 'materials', hash, extra);
  return (
    <div className="admin-dashboard material-processing tenant-material-page">
      <PageActions>
        <Button variant="ghost" icon={Recycle} onClick={() => setRecycle(true)}>
          回收站
        </Button>
      </PageActions>
      <nav className="platform-detail-nav" aria-label="资料库栏目">
        <a className="button ghost" aria-current={governance ? 'page' : undefined} href={href()}>
          数据治理
        </a>
        <a className="button ghost" aria-current={!files && !governance ? 'page' : undefined} href={href({ section: 'processing' })}>
          解析处理
        </a>
        <a
          className="button ghost"
          aria-current={files ? 'page' : undefined}
          href={href({ section: 'files', scope: 'enterprise' })}
        >
          文件与目录
        </a>
      </nav>
      {context.error ? (
        <Failure error={context.error} retry={() => setAttempt((n) => n + 1)} />
      ) : !context.value ? (
        <Loading />
      ) : (
        <>
          {governance ? <MaterialGovernance tenant={tenant} /> : files ? (
            <LiveLibrary tenant={tenant} administration />
          ) : (
            <ProcessingList tenant={tenant} context={context.value} />
          )}
          {recycle && (
            <RecycleSpaces tenant={tenant} context={context.value} close={() => setRecycle(false)} />
          )}
        </>
      )}
    </div>
  );
}
function ProcessingList({ tenant, context }: { tenant: string; context: TenantContext }) {
  const [query, setQuery] = useViewState(tenant, 'admin-materials:query', '', textState),
    [input, setInput] = useState(query);
  const [space, setSpace] = useViewState(tenant, 'admin-materials:space', '', textState);
  const [state, setState] = useViewState<MaterialProcessingPage['state']>(
    tenant,
    'admin-materials:state',
    'ALL',
    stateValue,
  );
  const [page, setPage] = useViewState(tenant, 'admin-materials:page', 0, pageState);
  const [selected, setSelected] = useViewState<Selection | null>(
    tenant,
    'admin-materials:selection',
    null,
    selectionValue,
  );
  const [attempt, setAttempt] = useState(0),
    refresh = () => setAttempt((n) => n + 1);
  const data = useRemote(
    (signal) => knowledgeClient.processing(tenant, space || null, query, state, page * 20, signal),
    [tenant, space, query, state, page, attempt, context],
  );
  const active = !!data.value?.summary.processing;
  useEffect(() => {
    if (!active || selected) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !requestNavigationLocked()) setAttempt((n) => n + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, [active, selected]);
  return (
    <>
      <div className="material-section">
        <div>
          <h2>资料处理</h2>
          <p className="muted">当前获权共享资料的最新版本；与客户端使用同一批文件。</p>
        </div>
        <Button variant="ghost" icon={RefreshCw} onClick={refresh}>
          刷新
        </Button>
      </div>
      {data.value && (
        <>
          <div className="processing-metrics">
            {(
              [
                ['资料总数', data.value.summary.total],
                ['已解析', data.value.summary.ready],
                ['处理中', data.value.summary.processing],
                ['需留意', data.value.summary.attention],
                ['尚未解析', data.value.summary.notStarted],
              ] as const
            ).map(([label, count]) => (
              <section className="admin-section" key={label}>
                <span>{label}</span>
                <strong>{count}</strong>
              </section>
            ))}
          </div>
          {!data.value.parserAvailable && (
            <p role="status" className="access-alert">
              解析服务尚未启用；已保存的文件和已有解析记录仍按权限查看。
            </p>
          )}
        </>
      )}
      <section className="admin-section">
        <form
          className="processing-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(input.trim());
            setPage(0);
          }}
        >
          <Field label="资料名称">
            <input
              value={input}
              maxLength={180}
              onChange={(e) => setInput(e.target.value)}
              placeholder="搜索文件名称"
            />
          </Field>
          <Field label="共享空间">
            <select
              value={space}
              onChange={(e) => {
                setSpace(e.target.value);
                setPage(0);
              }}
            >
              <option value="">全部获权空间</option>
              {space && !context.workspaces.some((s) => s.id === space && s.kind === 'SHARED') && (
                <option value={space}>原空间当前不可用</option>
              )}
              {context.workspaces
                .filter((s) => s.kind === 'SHARED')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="处理状态">
            <select
              value={state}
              onChange={(e) => {
                setState(e.target.value as MaterialProcessingPage['state']);
                setPage(0);
              }}
            >
              {Object.entries(states).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit">搜索</Button>
        </form>
        <p className="muted processing-caption">
          摘要按所选空间统计，不随名称或状态筛选缩减。“需留意”包含部分解析、失败、不支持及已取消。
        </p>
        {data.error ? (
          <Failure error={data.error} retry={refresh} />
        ) : !data.value ? (
          <Loading />
        ) : (
          <>
            <div className="tenant-directory-scroll">
              <div className="tenant-list-columns tenant-material-grid">
                <span></span>
                <span>资料 / 所属空间</span>
                <span>处理状态</span>
                <span>更新时间</span>
                <span></span>
              </div>
              <div className="processing-list">
                {data.value.items.map((item) => (
                  <button
                    key={item.materialId}
                    className="processing-row tenant-material-grid"
                    onClick={() =>
                      setSelected({
                        id: item.materialId,
                        workspaceId: item.workspaceId,
                        versionId: item.versionId,
                      })
                    }
                  >
                    <FileText size={22} />
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {item.workspaceName} · v{item.version}
                      </small>
                    </div>
                    <Badge>{processingStatusLabel[item.status]}</Badge>
                    <small>更新于 {date(item.updatedAt)}</small>
                    <span>查看详情</span>
                  </button>
                ))}
              </div>
            </div>
            {!data.value.items.length && (
              <Empty
                icon={FileText}
                title={query || state !== 'ALL' ? '没有符合条件的资料' : '暂无可查看的共享资料'}
                text="这里只显示已加入资料库且当前获权的文件。"
              />
            )}
            {(page > 0 || data.value.hasMore) && (
              <Pager page={page} next={data.value.hasMore} onPage={setPage} />
            )}
          </>
        )}
      </section>
      {selected && data.value && (
        <ProcessingDetail
          key={selected.id + selected.versionId}
          tenant={tenant}
          selected={selected}
          context={context}
          maxBytes={data.value.maxUploadBytes}
          close={() => {
            setSelected(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
function ProcessingDetail({
  tenant,
  selected,
  context,
  maxBytes,
  close,
}: {
  tenant: string;
  selected: Selection;
  context: TenantContext;
  maxBytes: number;
  close: () => void;
}) {
  const [attempt, setAttempt] = useState(0),
    [original, setOriginal] = useState(false),
    [maintenance, setMaintenance] = useState(false);
  const data = useRemote(
    async (signal) => {
      const [detail, version] = await Promise.all([
        materialClient.detail(tenant, selected.workspaceId, selected.id, 0, signal),
        materialClient.version(tenant, selected.workspaceId, selected.id, selected.versionId, signal),
      ]);
      return { detail, version };
    },
    [tenant, selected.id, selected.workspaceId, selected.versionId, context, attempt],
  );
  if (data.error)
    return (
      <Modal title="资料当前不可用" onClose={close}>
        <Failure error={data.error} retry={() => setAttempt((n) => n + 1)} />
      </Modal>
    );
  if (original && data.value)
    return (
      <DocumentDialog
        tenant={tenant}
        entry={selected}
        maxBytes={maxBytes}
        verification={context}
        administration
        close={() => {
          setOriginal(false);
          setAttempt((n) => n + 1);
        }}
        changed={() => {}}
      />
    );
  if (maintenance && data.value?.detail.document.canMaintain)
    return (
      <MaterialMaintenance
        tenant={tenant}
        workspace={selected.workspaceId}
        entries={[data.value.detail.document]}
        verification={context}
        close={() => {
          setMaintenance(false);
          setAttempt((n) => n + 1);
        }}
        changed={() => {}}
      />
    );
  return (
    <Modal title="资料处理详情" onClose={close} wide>
      {!data.value ? (
        <Loading />
      ) : (
        <div className="processing-detail">
          <h3>
            {data.value.version.filename} · v{data.value.version.number}
          </h3>
          <p className="muted">
            {data.value.detail.document.workspaceName} · 原件保存于 {date(data.value.version.createdAt)}
          </p>
          {data.value.version.number !== data.value.detail.document.version && (
            <p role="status">已有更新版本，当前仍查看打开时的 v{data.value.version.number}。</p>
          )}
          <div className="processing-detail-actions">
            <Button onClick={() => setOriginal(true)}>原件与历史版本</Button>
            {data.value.detail.document.canMaintain && (
              <Button variant="ghost" onClick={() => setMaintenance(true)}>
                维护与回收站
              </Button>
            )}
          </div>
          <AnalysisPanel
            tenant={tenant}
            space={selected.workspaceId}
            material={selected.id}
            version={selected.versionId}
            verification={data.value}
          />
        </div>
      )}
    </Modal>
  );
}
function RecycleSpaces({
  tenant,
  context,
  close,
}: {
  tenant: string;
  context: TenantContext;
  close: () => void;
}) {
  const [space, setSpace] = useState('');
  if (space)
    return (
      <MaterialMaintenance
        tenant={tenant}
        workspace={space}
        entries={[]}
        recycleOnly
        verification={context}
        close={() => setSpace('')}
        changed={() => {}}
      />
    );
  const shared = context.workspaces.filter((s) => s.kind === 'SHARED');
  return (
    <Modal title="资料回收站" onClose={close}>
      <p className="muted">选择共享空间，按当前资料维护权限查看回收与清理记录。</p>
      <div className="processing-recycle-spaces">
        {shared.map((s) => (
          <Button key={s.id} onClick={() => setSpace(s.id)}>
            {s.name}
          </Button>
        ))}
      </div>
      {!shared.length && <p>暂无获权共享空间。</p>}
    </Modal>
  );
}
