import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from 'react';
import type { DemoState } from './model';
import { createKongguSeed } from './kongguSeed';
import { KONGGU_STORAGE_KEY } from './kongguSources';
import { loadKongguState } from './kongguStorage';
import { loadNinepopSession } from './ninepop/session';
import { syncBriefing, type BriefingReference } from './briefing';

const KEY = KONGGU_STORAGE_KEY;
function load(): DemoState {
  return loadKongguState(localStorage);
}
type Store = {
  state: DemoState;
  change: <T>(fn: (draft: DemoState) => T) => T;
  reset: () => void;
  storageError: boolean;
};
const Context = createContext<Store>(null!);
export function DemoProvider({
  children,
  initialState,
  privateStorageKey,
}: {
  children: ReactNode;
  initialState?: DemoState;
  privateStorageKey?: string;
}) {
  const storage = privateStorageKey ? sessionStorage : localStorage;
  const storageKey = privateStorageKey || KEY;
  const [state, setState] = useState(() =>
    initialState ? loadNinepopSession(initialState, storage) : load(),
  );
  const current = useRef(state);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    try {
      storage.setItem(storageKey, JSON.stringify(current.current));
    } catch {
      setStorageError(true);
    }
  }, []);
  function save(next: DemoState) {
    syncBriefing(next);
    current.current = next;
    setState(next);
    try {
      storage.setItem(storageKey, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  function change<T>(fn: (draft: DemoState) => T): T {
    const next = structuredClone(current.current);
    const result = fn(next);
    save(next);
    return result;
  }
  return (
    <Context.Provider
      value={{
        state,
        change,
        reset: () => save(initialState ? structuredClone(initialState) : createKongguSeed()),
        storageError,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useDemo = () => useContext(Context);
export type DialogSpec = {
  kind: string;
  anchor?: HTMLElement;
  anchorSide?: 'top' | 'bottom';
  id?: string;
  target?: string;
  folderId?: string;
  title?: string;
  text?: string;
  onConfirm?: () => void;
  initial?: string;
};
export type NewConversationDraft = {
  text: string;
  space: string;
  refs: string[];
  refVersions?: Record<string, string>;
};
export type LibraryView = {
  query: string;
  status: string;
  layout: 'cards' | 'list';
  sort: 'updated' | 'name';
  scrollTop: number;
};
export type BriefingView = {
  tab: '推荐' | '最新' | '关注' | '日期' | '类型' | '空间';
  type: string;
  scope: string;
  day: string;
  closed: boolean;
  scrollTop: number;
};
export type ConversationOrigin = {
  element: HTMLElement;
  reference: BriefingReference;
  visual?: import('./components/conversationMotion').BriefingVisual;
  surface?: 'detail';
  readingScroll?: number;
  returnFocus?: HTMLElement;
};
export type DraftConversationOrigin = {
  visual: import('./components/conversationMotion').BriefingVisual;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: 'forward' | 'backward' | 'none';
};
export type ConversationPresentation = 'page' | 'overlay';
export type UI = {
  route: string;
  go: (path: string, origin?: ConversationOrigin) => void;
  openConversationPage: () => void;
  openDraftConversation: (origin: DraftConversationOrigin) => void;
  open: (dialog: DialogSpec) => void;
  close: () => void;
  toast: (text: string) => void;
  preview: (id: string | null, versionId?: string) => void;
  askMaterial: (id: string, versionId: string) => void;
  libraryViews: RefObject<Record<string, LibraryView>>;
  libraryScope: string;
  setLibraryScope: (id: string) => void;
  newDraft: NewConversationDraft;
  setNewDraft: Dispatch<SetStateAction<NewConversationDraft>>;
  briefingViews: RefObject<Record<string, BriefingView>>;
  returnToBriefing: () => void;
  conversationDrafts: Record<string, string>;
  setConversationDraft: (id: string, value: string) => void;
  conversationOpen: boolean;
  conversationListState: RefObject<{ width: number; folded: string[]; scrollTop: number }>;
};
export const UIContext = createContext<UI>(null!);
export const useUI = () => useContext(UIContext);
