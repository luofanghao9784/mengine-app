import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/shared/theme.css';
import '../../../src/identity/access.css';
import '../../../src/identity/workspace.css';
import '../../../src/material/material.css';
const tenant = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
let sequence = 100,
  release: (() => void) | undefined,
  fail = false;
const entries: any[] = [];
const receipts = new Map<string, any>();
const uid = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
const entry = (name: string, kind: string, folderId: string | null) => ({
  id: uid(),
  tenantId: tenant,
  workspaceId: workspace,
  workspaceName: '合成个人空间',
  folderId,
  kind,
  name,
  version: kind === 'FOLDER' ? 0 : 1,
  sizeBytes: kind === 'FOLDER' ? null : 4,
  updatedAt: new Date().toISOString(),
  path: [name],
  canMaintain: true,
});
entries.push(entry('报表.txt', 'DOCUMENT', null), entry('合成资料', 'FOLDER', null));
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (url.pathname.endsWith('/me'))
    return Response.json({
      account: { id: tenant, email: 'fixture@example.test', displayName: '合成验收' },
      platformAdmin: false,
      memberships: [],
    });
  if (url.pathname.endsWith('/csrf'))
    return Response.json({ token: 'synthetic', headerName: 'X-CSRF-TOKEN' });
  if (url.pathname.endsWith('/library')) {
    const folder = url.searchParams.get('folder');
    const offset = Number(url.searchParams.get('offset') || 0);
    const all = entries.filter((item) => item.folderId === folder);
    return Response.json({
      tenantId: tenant,
      workspaceId: workspace,
      folderId: folder,
      canMaintain: true,
      maxUploadBytes: 20971520,
      trail: [],
      items: all.slice(offset, offset + 24),
      hasMore: all.length > offset + 24,
    });
  }
  if (url.pathname.endsWith('/folders')) {
    const body = JSON.parse(String(init?.body));
    if (receipts.has(body.requestId)) return Response.json(receipts.get(body.requestId));
    const folder = entry(body.name, 'FOLDER', body.parentId);
    entries.push(folder);
    receipts.set(body.requestId, folder);
    return Response.json(folder);
  }
  if (url.pathname.endsWith('/materials')) {
    const form = init!.body as FormData;
    const body = JSON.parse(await (form.get('metadata') as Blob).text());
    const file = form.get('file') as File;
    if (receipts.has(body.requestId)) return Response.json(receipts.get(body.requestId));
    await new Promise<void>((resolve, reject) => {
      release = resolve;
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    release = undefined;
    const saved = { ...entry(file.name, 'DOCUMENT', body.folderId), sizeBytes: file.size };
    const value = {
      ...saved,
      receiptStatus: 'EXACT',
      currentVersion: 1,
      acceptedVersion: {
        id: uid(),
        number: 1,
        filename: file.name,
        sizeBytes: file.size,
        sha256: 'a'.repeat(64),
        createdBy: tenant,
        createdAt: saved.updatedAt,
      },
    };
    entries.push(saved);
    receipts.set(body.requestId, value);
    if (fail) {
      fail = false;
      throw new TypeError('Synthetic response lost after save');
    }
    return Response.json(value, { status: 201 });
  }
  throw new Error('Unexpected synthetic endpoint');
};
// Dynamic imports ensure production clients use the fixture transport, never a real API.
const { SessionProvider } = await import('../../../src/identity/session');
const { UploadProvider } = await import('../../../src/material/UploadManager');
const { MaterialUploadDialog } = await import('../../../src/material/BatchUpload');
function Fixture() {
  const [dialog, setDialog] = useState(false),
    [page, setPage] = useState('资料库');
  return (
    <UploadProvider>
      <main style={{ padding: 28 }}>
        <p>合成验收 · 不连接真实服务</p>
        <h1>{page}</h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
          <button className="button primary" onClick={() => setDialog(true)}>
            上传资料
          </button>
          <button
            className="button"
            onClick={() => {
              setPage(page === '资料库' ? '会话' : '资料库');
              setDialog(false);
            }}
          >
            切换页面
          </button>
          <button className="button" onClick={() => release?.()}>
            完成当前模拟上传
          </button>
          <button
            className="button"
            onClick={() => {
              fail = true;
            }}
          >
            模拟下一次回执丢失
          </button>
        </div>
        <p style={{ marginTop: 24 }}>当前目录已有“报表.txt”和“合成资料”文件夹。</p>
        {dialog && (
          <MaterialUploadDialog
            tenant={tenant}
            workspace={workspace}
            parent={null}
            scope="personal"
            workspaceName="合成个人空间"
            close={() => setDialog(false)}
          />
        )}
      </main>
    </UploadProvider>
  );
}
createRoot(document.getElementById('root')!).render(
  <SessionProvider>
    <Fixture />
  </SessionProvider>,
);
