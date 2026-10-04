import { DocumentCard } from './DocumentCard';
export { DocumentCard } from './DocumentCard';
import { ExportBatchPanel } from '../export/ExportBatchPanel';
import { RequestPending, requestNavigationLocked, useRequestLock } from '../shared/request-guard';
import { useContext, useEffect, useRef, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { identityClient, useSession } from '../identity/session';
import { Button, PageActions, Empty } from '../shared/ui';
import { Failure, Loading, Pager, SubmitError, useRemote, useSubmission } from '../shared/admin';
import { documentClient as api } from './client';
import { libraryHref } from '../material/Library';
import './documents.css';
import { documentsHref } from './routes';
export function SaveAsDocument({
  tenant,
  conversation,
  task,
  artifact,
  label = '保存到个人资料',
}: {
  tenant: string;
  conversation: string;
  task: string;
  artifact?: string;
  label?: string;
}) {
  const submit = useSubmission<object>();
  useRequestLock(submit.busy || submit.uncertain);
  const [saved,setSaved]=useState<string>();
  const [reading,setReading]=useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <span className="save-document">
      <Button
        icon={FileText}
        disabled={submit.busy||!!saved}
        onClick={() =>
          void submit.submit({}, async (_, requestId) => {
            const origin = location.hash;
            const value = await api.create(tenant, {
              requestId,
              conversationId: conversation,
              taskId: task,
              ...(artifact ? { artifactId: artifact } : {}),
            });
            if (mounted.current && location.hash === origin)
              setSaved(value.document.id);
          })
        }
      >
        {saved?'已保存到个人资料':label}
      </Button>
      {saved&&<Button onClick={()=>setReading(true)}>查看资料</Button>}
      {saved&&reading&&<DocumentCard tenant={tenant} id={saved} close={()=>setReading(false)}/>}
      <SubmitError error={submit.error} uncertain={submit.uncertain} />
    </span>
  );
}
export function Documents({ tenant }: { tenant: string }) {
  const [hash, setHash] = useState(location.hash),
    [attempt, setAttempt] = useState(0),
    [page, setPage] = useState(0);
  const { session } = useSession();
  const pendingRequest = useContext(RequestPending);
  const context = useRemote((signal) => identityClient.context(tenant, signal), [tenant, session.identity]);
  const personal = context.value?.workspaces.find((w) => w.kind === 'PERSONAL');
  const refresh = () => {
    if (!pendingRequest) setAttempt((n) => n + 1);
  };
  useEffect(() => {
    const change = () => {
      if (!requestNavigationLocked()) setHash(location.hash);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const params = new URLSearchParams(hash.slice(1)),
    selected = params.get('document') || undefined,
    rawVersion = params.get('version'),
    version = rawVersion ? Number(rawVersion) : undefined;
  useEffect(() => {
    const check = () => {
      if (!pendingRequest && document.visibilityState === 'visible') setAttempt((n) => n + 1);
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, 15000);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      clearInterval(timer);
    };
  }, [pendingRequest]);
  return (
    <section className="private-documents">
      <PageActions>
        <Button variant="ghost" icon={RefreshCw} disabled={pendingRequest} onClick={refresh}>
          刷新
        </Button>
      </PageActions>
      <div className="document-breadcrumb">
        <a href={libraryHref(tenant)}>资料库</a>
        <span> / </span>
        <a href={documentsHref(tenant)}>个人文稿</a>
      </div>
      <p className="muted">仅自己可见。来源空间撤权后，文稿仍保留，但不能查看、编辑或导出。</p>
      {personal && (
        <ExportBatchPanel
          tenant={tenant}
          workspace={personal.id}
          workspaceName={personal.name}
          scope="PRIVATE"
        />
      )}
      {selected ? (
        <DocumentReader
          key={selected + ':' + (version || 'latest')}
          tenant={tenant}
          id={selected}
          version={version}
          invalid={!!rawVersion && (!Number.isSafeInteger(version) || Number(version) < 1)}
          attempt={attempt}
          refresh={refresh}
        />
      ) : (
        <DocumentList
          tenant={tenant}
          page={page}
          setPage={setPage}
          attempt={attempt}
          identity={session.identity}
          refresh={refresh}
        />
      )}
    </section>
  );
}
function DocumentList({
  tenant,
  page,
  setPage,
  attempt,
  identity,
  refresh,
}: {
  tenant: string;
  page: number;
  setPage: (n: number) => void;
  attempt: number;
  identity: unknown;
  refresh: () => void;
}) {
  const data = useRemote((signal) => api.list(tenant, page * 20, signal), [tenant, page, attempt, identity]);
  if (data.error) return <Failure error={data.error} retry={refresh} />;
  if (!data.value) return <Loading />;
  return (
    <>
      {!data.value.items.length ? (
        <Empty
          icon={FileText}
          title="还没有可访问的个人文稿"
          text="在完成的会话回复或 TXT/Markdown 成果旁选择保存，之后可在这里编辑和导出。"
        />
      ) : (
        <div className="document-list">
          {data.value.items.map((doc) => (
            <a key={doc.id} href={documentsHref(tenant, doc.id)}>
              <FileText />
              <strong>{doc.title}</strong>
              <span>v{doc.revision}</span>
              <time>{new Date(doc.updatedAt).toLocaleString()}</time>
            </a>
          ))}
        </div>
      )}
      <Pager page={page} next={data.value.hasMore} onPage={setPage} />
    </>
  );
}
export function DocumentReader({ tenant, id, version, invalid, attempt }: {
  tenant: string;
  id: string;
  version?: number;
  invalid: boolean;
  attempt: number;
  refresh: () => void;
}) {
  return <DocumentCard tenant={tenant} id={id} initialVersion={version} invalid={invalid}
    readAttempt={attempt} close={() => { location.hash = documentsHref(tenant); }} />;
}
