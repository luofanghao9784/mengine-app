import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Search,
  Upload,
  Folder,
  FolderPlus,
  FileText,
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  UserRound,
  LibraryBig,
  Grid2X2,
  List,
} from 'lucide-react';
import { useDemo, useUI, type LibraryView } from '../store';
import { latest, spaceName, type Material } from '../model';
import { createDemoMaterialReadModel } from '../data/materialReadModel';
import {
  canManageFolder,
  folderTrail,
  libraryPath,
  locationNames,
  visibleSpaces,
  sortMaterials,
} from '../libraryModel';
import { Button, PageActions, Badge, Empty } from '../components/ui';
import { MaterialReader } from '../components/MaterialView';
import { BriefingDocumentCovers } from '../components/BriefingMedia';

function MaterialCover({ material }: { material: Material }) {
  const version = latest(material);
  const lines = version.content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    <div className="library-document-cover" aria-hidden="true">
      <span className="library-cover-type">
        <FileText size={13} />
        {material.type}
      </span>
      <strong>{material.title}</strong>
      <div className="library-cover-excerpt">
        {lines.slice(0, 3).map((line, index) => (
          <p key={index}>{line.replace(/^#+\s*/, '')}</p>
        ))}
      </div>
      <span className="library-cover-version">v{version.number}</span>
    </div>
  );
}

export function Library({ scope, docId }: { scope: string; docId?: string }) {
  const { state } = useDemo();
  const materials = createDemoMaterialReadModel(() => state);
  const ui = useUI();
  const params = new URLSearchParams(ui.route.split('?')[1]);
  const doc = materials.findVisible(docId);
  const direct =
    !!docId && !params.has('folder') && !params.has('view') && !params.has('q') && !params.has('status');
  const folderId = params.get('folder') || (direct && doc?.space === scope ? doc.folderId : undefined);
  const all = scope === 'all' || params.get('view') === 'all';
  const enterpriseRoot = scope === 'enterprise' || scope === 'all';
  const personal = scope === 'personal';
  const viewKey = scope + '/' + (folderId || '') + '/' + (all ? 'all' : 'folders');
  const saved = ui.libraryViews.current[viewKey];
  const preferences = ui.libraryViews.current.preferences;
  const [query, setQuery] = useState(params.get('q') ?? saved?.query ?? '');
  const [status, setStatus] = useState(params.get('status') ?? saved?.status ?? '全部');
  const [layout, setLayout] = useState<LibraryView['layout']>(
    saved?.layout || preferences?.layout || 'cards',
  );
  const [sort, setSort] = useState<LibraryView['sort']>(saved?.sort || preferences?.sort || 'updated');
  const root = useRef<HTMLDivElement>(null);
  const reading = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const scrollTop = useRef(saved?.scrollTop || 0);
  const spaces = visibleSpaces(state);
  let trail: ReturnType<typeof folderTrail> = [];
  let invalid = false;
  try {
    if (!enterpriseRoot) trail = folderTrail(state, scope, folderId);
  } catch {
    invalid = true;
  }
  const validScope = enterpriseRoot || personal || spaces.some((space) => space.id === scope);
  const validDoc = !docId || (!!doc && (enterpriseRoot ? doc.space !== 'personal' : doc.space === scope));
  const listingParams = new URLSearchParams();
  if (folderId) listingParams.set('folder', folderId);
  if (all) listingParams.set('view', 'all');
  if (query) listingParams.set('q', query);
  if (status !== '全部') listingParams.set('status', status);
  const suffix = listingParams.size ? '?' + listingParams : '';
  const backPath = 'library/' + scope + suffix;
  const currentView = useRef({ query, status, layout, sort, scrollTop: scrollTop.current });
  currentView.current = { query, status, layout, sort, scrollTop: scrollTop.current };
  useEffect(() => {
    ui.setLibraryScope(backPath.slice('library/'.length));
    ui.libraryViews.current[viewKey] = currentView.current;
    ui.libraryViews.current.preferences = currentView.current;
  }, [backPath, viewKey, layout, sort]);
  useLayoutEffect(() => {
    const scroller = root.current?.closest<HTMLElement>('.page-main');
    if (!scroller) return;
    scroller.scrollTop = scrollTop.current;
    const track = () => {
      if (!docId) scrollTop.current = scroller.scrollTop;
    };
    scroller.addEventListener('scroll', track, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', track);
      ui.libraryViews.current[viewKey] = { ...currentView.current, scrollTop: scrollTop.current };
    };
  }, [viewKey, docId]);
  const close = () => ui.go(backPath);
  useEffect(() => {
    if (!docId || !validDoc || ui.conversationOpen) return;
    closeButton.current?.focus({ preventScroll: true });
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key === 'Tab') {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            '.sidebar button, .library-reader-layer button, .library-reader-layer select, .library-reader-layer input',
          ),
        ).filter(
          (element) =>
            !element.closest('[inert]') && !element.matches(':disabled') && element.getClientRects().length,
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [docId, validDoc, ui.conversationOpen]);
  if (!validScope || invalid || !validDoc)
    return (
      <div ref={root} className="page-container library-page library-redesign">
        <Empty icon={Folder} title="此位置暂不可用" text="资料或文件夹不存在，或你没有查看权限。">
          <Button onClick={() => ui.go('library/' + (personal ? 'personal' : 'enterprise'))}>
            返回{personal ? '个人空间' : '企业资料库'}
          </Button>
        </Empty>
      </div>
    );
  const searching = !!query.trim() || status !== '全部';
  const visibleDocs = materials.listVisible();
  const inScope = visibleDocs.filter((material) =>
    enterpriseRoot ? material.space !== 'personal' : material.space === scope,
  );
  const matches = inScope.filter((material) => {
    const inFolder =
      !folderId ||
      folderTrail(state, material.space, material.folderId).some((folder) => folder.id === folderId);
    const currentFolder = material.folderId === folderId;
    return (
      (searching ? inFolder : all || enterpriseRoot || currentFolder) &&
      (status === '全部' || material.status === status) &&
      [
        material.title,
        material.summary,
        material.tags.join(' '),
        locationNames(state, material.space, material.folderId).join(' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    );
  });
  const recent = enterpriseRoot && !all && !searching;
  const docs = sortMaterials(recent ? sortMaterials(matches, 'updated').slice(0, 6) : matches, sort);
  const folderRows =
    searching || all
      ? []
      : enterpriseRoot
        ? spaces.map((space) => ({
            id: space.id,
            name: space.name,
            path: libraryPath(space.id),
            description: space.description,
            docs: inScope.filter((material) => material.space === space.id),
          }))
        : (state.folders || [])
            .filter((folder) => folder.space === scope && folder.parentId === folderId)
            .map((folder) => ({
              id: folder.id,
              name: folder.name,
              path: libraryPath(scope, folder.id),
              description: '文件夹',
              docs: inScope.filter((material) =>
                folderTrail(state, scope, material.folderId).some((parent) => parent.id === folder.id),
              ),
            }));
  const canOrganize = !enterpriseRoot && canManageFolder(state, scope);
  const crumbs = [
    { name: personal ? '个人空间' : '企业资料库', path: 'library/' + (personal ? 'personal' : 'enterprise') },
  ];
  if (!personal && !enterpriseRoot) crumbs.push({ name: spaceName(state, scope), path: libraryPath(scope) });
  trail.forEach((folder) => crumbs.push({ name: folder.name, path: libraryPath(scope, folder.id) }));
  const breadcrumb = (includeDoc = false) => (
    <nav className="library-breadcrumbs" aria-label="文件夹路径">
      {crumbs.map((crumb, index) => (
        <span key={crumb.path}>
          {index > 0 && <ChevronRight size={13} />}
          <button onClick={() => ui.go(crumb.path)}>{crumb.name}</button>
        </span>
      ))}
      {includeDoc && doc && (
        <span>
          <ChevronRight size={13} />
          <span aria-current="page">{doc.title}</span>
        </span>
      )}
    </nav>
  );
  const openDoc = (material: Material) => {
    const scroller = root.current?.closest<HTMLElement>('.page-main');
    if (scroller) scrollTop.current = scroller.scrollTop;
    ui.libraryViews.current[viewKey] = { ...currentView.current, scrollTop: scrollTop.current };
    ui.go('library/' + scope + '/' + material.id + suffix);
  };
  return (
    <div ref={root} className="page-container library-page library-redesign">
      {!doc && (
        <PageActions>
          <div className="library-tabs" role="group" aria-label="资料范围">
            <button aria-pressed={personal} onClick={() => ui.go('library/personal')}>
              <UserRound size={17} />
              个人空间
            </button>
            <button aria-pressed={!personal} onClick={() => ui.go('library/enterprise')}>
              <LibraryBig size={17} />
              企业资料库
            </button>
          </div>
          <div className="search-input library-header-search">
            <Search size={16} />
            <input
              aria-label="搜索资料"
              placeholder={enterpriseRoot ? '搜索企业资料名称、简介或路径' : '搜索当前文件夹及子文件夹'}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button className="library-clear" onClick={() => setQuery('')} aria-label="清空搜索">
                清空
              </button>
            )}
          </div>
          <div className="library-header-buttons">
            {canOrganize && (
              <Button icon={FolderPlus} onClick={() => ui.open({ kind: 'folder', target: scope, folderId })}>
                新建文件夹
              </Button>
            )}
            <Button
              variant="primary"
              icon={Upload}
              onClick={() =>
                ui.open({ kind: 'upload', target: enterpriseRoot ? 'enterprise' : scope, folderId })
              }
            >
              添加资料
            </Button>
          </div>
        </PageActions>
      )}
      <div className="library-browser" inert={!!doc} aria-hidden={!!doc || undefined}>
        <div className="library-toolbar toolbar">
          <div className="library-location-row">
            {breadcrumb()}
            {!enterpriseRoot && !personal && (
              <Button variant="ghost" icon={ArrowUpRight} onClick={() => ui.go('space/' + scope)}>
                空间概览
              </Button>
            )}
          </div>
          <div className="library-controls">
            {enterpriseRoot && (
              <div className="library-view-switch" role="group" aria-label="企业资料视图">
                <button
                  aria-pressed={!all}
                  onClick={() => {
                    listingParams.delete('view');
                    ui.go('library/enterprise?' + listingParams);
                  }}
                >
                  文件夹
                </button>
                <button
                  aria-pressed={all}
                  onClick={() => {
                    listingParams.set('view', 'all');
                    ui.go('library/enterprise?' + listingParams);
                  }}
                >
                  全部资料
                </button>
              </div>
            )}
            <select
              aria-label="筛选资料状态"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {['全部', '使用中', '已过期', '已归档'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="资料排序"
              value={sort}
              onChange={(event) => setSort(event.target.value as LibraryView['sort'])}
            >
              <option value="updated">最近更新</option>
              <option value="name">名称排序</option>
            </select>
            <div className="library-layout-switch" role="group" aria-label="资料排版">
              <button
                aria-label="卡片视图"
                aria-pressed={layout === 'cards'}
                onClick={() => setLayout('cards')}
              >
                <Grid2X2 size={17} />
              </button>
              <button
                aria-label="列表视图"
                aria-pressed={layout === 'list'}
                onClick={() => setLayout('list')}
              >
                <List size={18} />
              </button>
            </div>
          </div>
        </div>
        {!!folderRows.length && (
          <section className="library-folder-section" aria-label="资料文件夹">
            <div className="library-section-title">
              <h2>{enterpriseRoot ? '工作空间' : '文件夹'}</h2>
              <span>{folderRows.length} 个文件夹</span>
            </div>
            <div className="library-folder-grid">
              {folderRows.map((folder) => (
                <button
                  key={folder.id}
                  className="library-folder-card"
                  aria-label={'打开文件夹：' + folder.name}
                  onClick={() => ui.go(folder.path)}
                >
                  <div className="library-folder-covers">
                    {folder.docs.length ? (
                      <BriefingDocumentCovers
                        documents={sortMaterials(folder.docs, 'updated')
                          .slice(0, 3)
                          .map((material) => ({
                            id: material.id,
                            title: material.title,
                            type: material.type,
                          }))}
                      />
                    ) : (
                      <Folder size={32} strokeWidth={1.3} />
                    )}
                  </div>
                  <div className="library-folder-label">
                    <strong>{folder.name}</strong>
                    <p>{folder.description}</p>
                    <small>{folder.docs.length} 份可见资料</small>
                  </div>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          </section>
        )}
        {!!docs.length && (
          <section className="library-materials" aria-label="资料列表">
            <div className="library-section-title">
              <h2>{searching ? '搜索结果' : recent ? '最近更新' : '资料'}</h2>
              {recent ? (
                <button onClick={() => ui.go('library/enterprise?view=all')}>
                  查看全部 <ArrowUpRight size={13} />
                </button>
              ) : (
                <span>{docs.length} 份资料</span>
              )}
            </div>
            {layout === 'cards' ? (
              <div className="library-material-grid">
                {docs.map((material) => (
                  <button
                    key={material.id}
                    className="library-material-card"
                    aria-label={'查看' + material.title}
                    onClick={() => openDoc(material)}
                  >
                    <MaterialCover material={material} />
                    <div className="library-material-copy">
                      <strong>{material.title}</strong>
                      <p>{material.summary}</p>
                      {(enterpriseRoot || searching || all) && (
                        <small className="library-card-path">
                          {locationNames(state, material.space, material.folderId).slice(1).join(' / ')}
                        </small>
                      )}
                      <div className="library-card-meta">
                        <span>
                          v{latest(material).number} ·{' '}
                          {material.confirmed === latest(material).id ? '已确认' : '待确认'}
                        </span>
                        {material.status !== '使用中' && <Badge>{material.status}</Badge>}
                        <span>
                          {material.owner} · {latest(material).date}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="table-wrap library-quiet-table">
                <table className="data-table library-table">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>资料路径</th>
                      <th>版本 / 状态</th>
                      <th>维护人</th>
                      <th>更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((material) => (
                      <tr key={material.id}>
                        <td>
                          <button
                            className="table-title"
                            aria-label={'查看' + material.title}
                            onClick={() => openDoc(material)}
                          >
                            <FileText size={20} />
                            <span>
                              <strong>{material.title}</strong>
                              <small>{material.summary}</small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <span className="library-path-text">
                            {locationNames(state, material.space, material.folderId).join(' / ')}
                          </span>
                        </td>
                        <td>
                          <div className="library-version-status">
                            <span>
                              v{latest(material).number} ·{' '}
                              {material.confirmed === latest(material).id ? '已确认' : '待确认'}
                            </span>
                            <small className="subtle">{material.status}</small>
                          </div>
                        </td>
                        <td>{material.owner}</td>
                        <td>{latest(material).date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {!docs.length && !folderRows.length && (
          <Empty
            icon={searching ? Search : Folder}
            title={searching ? '没有找到相关资料' : '这里还没有资料'}
            text={searching ? '试试其他关键词或资料状态。' : '添加资料，或按需要建立子文件夹。'}
          />
        )}
      </div>
      {doc && (
        <div
          ref={reading}
          className="library-reader-layer"
          role="dialog"
          aria-modal="false"
          aria-label="资料阅读视窗"
        >
          <div className="library-reader-backdrop" onClick={close} />
          <div className="library-reader-frame">
            <div className="library-reader-location">
              <button ref={closeButton} className="button ghost" onClick={close}>
                <ArrowLeft size={16} />
                {searching || all || enterpriseRoot ? '返回资料列表' : '返回所在文件夹'}
              </button>
              {breadcrumb(true)}
            </div>
            <MaterialReader
              key={doc.id}
              id={doc.id}
              initialVersionId={params.get('version') || undefined}
              onClose={close}
            />
          </div>
        </div>
      )}
    </div>
  );
}
