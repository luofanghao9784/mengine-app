import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, LibraryBig, MessageSquare, Newspaper } from 'lucide-react';
import { useDemo, useUI } from '../store';
import { DreamcoreLogo } from './DreamcoreLogo';

export function Sidebar() {
  const { state } = useDemo();
  const ui = useUI();
  const [expanded, setExpanded] = useState<string | null>(null);
  const rail = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const expand = (id: string) => {
    clearClose();
    setExpanded(id);
  };
  const dismiss = () => {
    clearClose();
    setExpanded(null);
  };
  useEffect(() => {
    dismiss();
  }, [ui.route]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!rail.current?.contains(event.target as Node)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      dismiss();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      clearClose();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const go = (path: string) => {
    dismiss();
    ui.go(path);
  };
  const open = (kind: 'search' | 'settings') => {
    dismiss();
    ui.open({ kind });
  };
  const interaction = (id: string) => ({
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType === 'mouse') expand(id);
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      clearClose();
      closeTimer.current = setTimeout(() => setExpanded((current) => (current === id ? null : current)), 140);
    },
    onFocusCapture: (event: React.FocusEvent) => {
      if (event.target.matches(':focus-visible')) expand(id);
    },
    onBlurCapture: (event: React.FocusEvent) => {
      if (expanded === id && !event.currentTarget.contains(event.relatedTarget as Node | null)) dismiss();
    },
  });
  const nav = [
    { path: 'conversations', label: '会话', Icon: MessageSquare },
    { path: 'briefing', label: '智能画报', Icon: Newspaper },
    { path: `library/${ui.libraryScope}`, label: '资料库', Icon: LibraryBig },
    { path: 'apps/all', label: '应用', Icon: LayoutGrid },
  ];
  return (
    <aside className="sidebar" aria-label="工作导航" ref={rail}>
      <button
        className="brand"
        aria-label="AI Dreamcore 梦核工作空间 · 返回智能画报"
        title="AI Dreamcore · 梦核工作空间"
        onClick={() => go('briefing')}
      >
        <DreamcoreLogo />
      </button>
      <nav aria-label="主导航">
        {nav.map(({ path, label, Icon }) => {
          const isChat = path === 'conversations';
          const active = isChat
            ? ui.conversationOpen || ui.route.split('/')[0] === 'space'
            : ui.route.split('/')[0] === path.split('/')[0];
          const isExpanded = expanded === path;
          return (
            <div key={path} className={`nav-item ${isExpanded ? 'is-expanded' : ''}`} {...interaction(path)}>
              <button
                className={`nav-link ${active ? 'active' : ''}`}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  if (isChat) {
                    dismiss();
                    ui.openConversationPage();
                  } else go(path);
                }}
              >
                <span className="nav-symbol">
                  <Icon size={21} strokeWidth={1.65} />
                </span>
                <span className="nav-label" aria-hidden="true">
                  {label}
                </span>
              </button>
            </div>
          );
        })}
      </nav>
      <footer className="sidebar-footer">
        <div
          className={`nav-item profile-item ${expanded === 'profile' ? 'is-expanded' : ''}`}
          {...interaction('profile')}
        >
          <button
            className="profile-button"
            aria-label={`${state.profile.name} 个人设置与记忆`}
            onClick={() => open('settings')}
          >
            <span className="nav-symbol">
              <span className="avatar">{state.profile.name[0]}</span>
            </span>
            <span className="profile-label" aria-hidden="true">
              <strong>{state.profile.name}</strong>
              <small>个人设置与记忆</small>
            </span>
          </button>
        </div>
      </footer>
    </aside>
  );
}
