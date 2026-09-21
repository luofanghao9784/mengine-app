import { useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import {
  UIContext,
  useDemo,
  type UI,
  type DialogSpec,
  type BriefingView,
  type NewConversationDraft,
  type ConversationOrigin,
  type DraftConversationOrigin,
  type ConversationPresentation,
  type LibraryView,
} from './store';
import { spaceName } from './model';
import { canReadMaterial } from './libraryModel';
import { Sidebar } from './components/Sidebar';
import { DreamcoreLogo } from './components/DreamcoreLogo';
import { IconButton, PageActionsContext } from './components/ui';
import { Dialogs } from './components/Dialogs';
import { BriefingComposer } from './components/NewConversation';
import { ConversationOverlay } from './components/ConversationOverlay';
import { Library } from './pages/Library';
import { Workspace } from './pages/Workspace';
import { Briefing } from './pages/Briefing';
import { Applications } from './pages/Tools';
import { localDate } from './briefing';
import { useAutoHideScrollbars } from './useAutoHideScrollbars';

const normalizeRoute = (path: string) => {
  const parts = path.split('/');
  if (parts[0] === 'colleagues') return 'home';
  if (parts[0] === 'dashboard') return `briefing/${parts[1] || 'personal'}`;
  if (parts[0] === 'workbench')
    return parts[1] === 'dashboard' ? `briefing/${parts[2] || 'personal'}` : 'briefing';
  return path;
};
const isConversationRoute = (path: string) => /^(chat|home)(\/|$)/.test(path);
type ConversationEntry = { presentation: ConversationPresentation; backgroundRoute: string };
const readConversationEntry = (path: string): ConversationEntry => {
  const entry = history.state?.conversationEntry;
  if (
    entry?.route === path &&
    (entry.presentation === 'page' || entry.presentation === 'overlay') &&
    typeof entry.backgroundRoute === 'string' &&
    !isConversationRoute(entry.backgroundRoute)
  )
    return entry;
  return { presentation: 'page', backgroundRoute: 'briefing' };
};

export default function App() {
  useAutoHideScrollbars();
  const { state, storageError } = useDemo();
  useEffect(() => {
    document.title = state.scenario === 'konggu' ? '空谷无界 · AI工作空间' : '企业AI工作空间';
  }, [state.scenario]);
  const [route, setRoute] = useState(() => normalizeRoute(location.hash.slice(2) || 'briefing'));
  const [presentation, setPresentation] = useState(() => readConversationEntry(route).presentation);
  const [backgroundRoute, setBackgroundRoute] = useState(() =>
    isConversationRoute(route) ? readConversationEntry(route).backgroundRoute : route,
  );
  const [origin, setOrigin] = useState<(ConversationOrigin & { chatRoute: string }) | null>(null);
  const [draftOrigin, setDraftOrigin] = useState<DraftConversationOrigin | null>(null);
  const [closing, setClosing] = useState<{ path: string; writeHash: boolean } | null>(null);
  const [newDraft, setNewDraft] = useState<NewConversationDraft>({ text: '', space: 'none', refs: [] });
  const [newConversationRequest, setNewConversationRequest] = useState(0);
  const [conversationDrafts, setConversationDrafts] = useState<Record<string, string>>({});
  const [previewRequest, setPreviewRequest] = useState<{
    id: string;
    versionId?: string;
    nonce: number;
  } | null>(null);
  const libraryViews = useRef<Record<string, LibraryView>>({});
  const deckWidths = useRef<Record<string, number>>({});
  const conversationListState = useRef({ width: 240, folded: [] as string[], scrollTop: 0 });
  const filePreferences = useRef<Record<string, { extra: string[]; hidden: string[] }>>({});
  const briefingViews = useRef<Record<string, BriefingView>>({});
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [notice, setNotice] = useState('');
  const [libraryScope, setLibraryScope] = useState('personal');
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);
  const conversationOpen = isConversationRoute(route);
  const commitRoute = (path: string, writeHash: boolean, entry?: ConversationEntry) => {
    setRoute(path);
    if (entry) {
      setPresentation(entry.presentation);
      setBackgroundRoute(entry.backgroundRoute);
    } else if (!isConversationRoute(path)) {
      setBackgroundRoute(path);
      setOrigin(null);
      setDraftOrigin(null);
    }
    if (writeHash) {
      const previous = history.state?.conversationEntry;
      const sameEntry =
        location.hash === `#/${path}` &&
        previous?.presentation === entry?.presentation &&
        previous?.backgroundRoute === entry?.backgroundRoute;
      const state = { ...history.state, conversationEntry: entry ? { ...entry, route: path } : null };
      // Store the entry alongside its URL so refresh and history traversal retain
      // page versus contextual presentation without changing saved work data.
      if (sameEntry) history.replaceState(state, '', `#/${path}`);
      else history.pushState(state, '', `#/${path}`);
    }
  };
  const navigate = (
    path: string,
    writeHash: boolean,
    source?: ConversationOrigin,
    draftSource?: DraftConversationOrigin,
    requestedEntry?: ConversationEntry,
  ) => {
    path = normalizeRoute(path);
    setDialog(null);
    if (conversationOpen && presentation === 'overlay' && !isConversationRoute(path)) {
      setClosing({ path, writeHash });
      return;
    }
    const entry: ConversationEntry | undefined = isConversationRoute(path)
      ? requestedEntry ||
        (writeHash
          ? {
              presentation: source || draftSource || !conversationOpen ? 'overlay' : presentation,
              backgroundRoute,
            }
          : readConversationEntry(path))
      : undefined;
    setClosing(null);
    if (source) setOrigin({ ...source, chatRoute: path });
    else if (path !== route || entry?.presentation !== presentation) setOrigin(null);
    if (draftSource) setDraftOrigin(draftSource);
    else if (path !== route || entry?.presentation !== presentation) setDraftOrigin(null);
    commitRoute(path, writeHash, entry);
  };
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    const onHash = () => {
      const path = normalizeRoute(location.hash.slice(2) || 'briefing');
      if (location.hash.slice(2) !== path) history.replaceState(history.state, '', `#/${path}`);
      navigateRef.current(path, false);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 3800);
    return () => clearTimeout(timeout);
  }, [notice]);
  const closeOverlay = () => navigate(backgroundRoute, true);
  const ui: UI = {
    route,
    openConversationPage: () => {
      filePreferences.current.home = { extra: [], hidden: [] };
      setNewConversationRequest((request) => request + 1);
      navigate('home', true, undefined, undefined, { presentation: 'page', backgroundRoute });
    },
    openDraftConversation: (source) => {
      filePreferences.current.home = { extra: [], hidden: [] };
      setNewConversationRequest((request) => request + 1);
      navigate('home', true, undefined, source);
    },
    go: (path, source) => {
      if (path === 'home') {
        filePreferences.current.home = { extra: [], hidden: [] };
        setNewConversationRequest((request) => request + 1);
      }
      navigate(path, true, source);
    },
    open: setDialog,
    close: () => setDialog(null),
    toast: setNotice,
    preview: (id, versionId) => {
      if (id) setPreviewRequest({ id, versionId, nonce: performance.now() });
    },
    askMaterial: (id, versionId) => {
      const material = state.materials.find((doc) => doc.id === id && canReadMaterial(state, doc));
      if (!material?.versions.some((version) => version.id === versionId)) return;
      setNewDraft((draft) => ({
        ...draft,
        refs: [...new Set([...draft.refs, id])],
        refVersions: { ...draft.refVersions, [id]: versionId },
      }));
      filePreferences.current.home = { extra: [], hidden: [] };
      setNewConversationRequest((request) => request + 1);
      navigate('home', true);
    },
    libraryViews,
    libraryScope,
    setLibraryScope,
    newDraft,
    setNewDraft,
    briefingViews,
    returnToBriefing: () =>
      navigate(backgroundRoute.startsWith('briefing') ? backgroundRoute : 'briefing', true),
    conversationDrafts,
    setConversationDraft: (id, value) => setConversationDrafts((drafts) => ({ ...drafts, [id]: value })),
    conversationOpen,
    conversationListState,
  };
  const [page, id, detail] = backgroundRoute.split('/');
  const currentApp = page === 'apps' && state.apps.find((app) => app.id === detail?.split('?')[0]);
  const title =
    page === 'space'
      ? spaceName(state, id)
      : currentApp
        ? detail.includes('?')
          ? '客户跟进来源记录'
          : currentApp.name
        : { briefing: '智能画报', library: '资料库', apps: '应用' }[page] || '智能画报';
  return (
    <UIContext.Provider value={ui}>
      <div
        className={`app-shell ${state.profile.compact ? 'compact' : ''} ${conversationOpen ? `has-conversation has-conversation-${presentation}` : ''}`}
      >
        <Sidebar />
        <UIContext.Provider value={{ ...ui, route: backgroundRoute }}>
          <div
            className="main-shell conversation-background"
            inert={conversationOpen}
            aria-hidden={conversationOpen || undefined}
          >
            <header
              className={`topbar ${page === 'briefing' ? 'briefing-topbar' : page === 'library' ? 'library-topbar' : ''}`}
            >
              <div className="row min-zero topbar-heading">
                <button
                  className="mobile-brand"
                  aria-label="关于 AI Dreamcore 梦核工作空间"
                  onClick={() => setDialog({ kind: 'help' })}
                >
                  <DreamcoreLogo />
                </button>
                {page === 'briefing' ? (
                  <div className="briefing-title-group">
                    <h1 className="topbar-title">{title}</h1>
                    <time className="briefing-edition" dateTime={localDate(new Date().toISOString())}>
                      {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}{' '}
                      {new Date().toLocaleDateString('zh-CN', { weekday: 'long' })}
                    </time>
                  </div>
                ) : (
                  <h1 className="topbar-title" title={title}>
                    {title}
                  </h1>
                )}
              </div>
              <div className="topbar-actions" ref={setActionsTarget} />
              <div className="row topbar-meta">
                <button className="mode-label" onClick={() => setDialog({ kind: 'help' })}>
                  <span className="tiny-dot" />
                  {state.scenario === 'konggu' ? '空谷无界 · 演示' : '演示模式'}
                </button>
              </div>
            </header>
            {storageError && (
              <div className="storage-error">浏览器存储空间不足，当前修改仅在本次打开期间保留。</div>
            )}
            <PageActionsContext.Provider value={actionsTarget}>
              <div className="main-stage">
                <main className="page-main" key={backgroundRoute}>
                  {page === 'space' ? (
                    <Workspace spaceId={id} />
                  ) : page === 'library' ? (
                    <Library scope={(id || 'personal').split('?')[0]} docId={detail?.split('?')[0]} />
                  ) : page === 'apps' ? (
                    <Applications scope={id || 'all'} appId={detail} />
                  ) : (
                    <Briefing />
                  )}
                </main>
                {page === 'briefing' && !conversationOpen && <BriefingComposer />}
              </div>
            </PageActionsContext.Provider>
          </div>
        </UIContext.Provider>
        {conversationOpen && (
          <ConversationOverlay
            key={presentation}
            presentation={presentation}
            route={route}
            origin={origin?.chatRoute === route ? origin : null}
            draftOrigin={route === 'home' ? draftOrigin : null}
            closing={!!closing}
            onClose={closeOverlay}
            onClosed={() => {
              if (!closing) return;
              commitRoute(closing.path, closing.writeHash);
              setClosing(null);
            }}
            previewRequest={previewRequest}
            widths={deckWidths}
            filePreferences={filePreferences}
            newConversationRequest={newConversationRequest}
          />
        )}
        {notice && (
          <div className="toast" role="status">
            <Sparkles size={16} />
            <span>{notice}</span>
            <IconButton icon={X} label="关闭提示" onClick={() => setNotice('')} />
          </div>
        )}
        {dialog && <Dialogs key={`${dialog.kind}-${dialog.id || ''}`} spec={dialog} />}
      </div>
    </UIContext.Provider>
  );
}
