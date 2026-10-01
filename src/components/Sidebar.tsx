import { useRef } from 'react';
import { LayoutGrid, LibraryBig, MessageSquare, Newspaper } from 'lucide-react';
import { useDemo, useUI } from '../store';
import { DreamcoreLogo } from './DreamcoreLogo';
import { NavIconButton, useNavHover } from './NavIconButton';

export function Sidebar() {
  const { state } = useDemo();
  const ui = useUI();
  const rail = useRef<HTMLElement>(null);
  const { expanded, dismiss, interaction } = useNavHover(rail, ui.route);
  const go = (path: string) => {
    dismiss();
    ui.go(path);
  };
  const open = (kind: 'search' | 'settings') => {
    dismiss();
    ui.open({ kind });
  };
  const nav = [
    { path: 'conversations', label: '会话', Icon: MessageSquare },
    { path: 'briefing', label: '智能画报', Icon: Newspaper },
    { path: `library/${ui.libraryScope}`, label: '资料库', Icon: LibraryBig },
    { path: 'apps/all', label: '应用', Icon: LayoutGrid },
  ];
  return (
    <aside className="sidebar" aria-label="工作导航" ref={rail}>
      <div
        className={`brand nav-item ${expanded === 'brand' ? 'is-expanded' : ''}`}
        {...interaction('brand')}
      >
        <button
          className="brand-button"
          aria-label="Mengine 梦擎工作空间 · 返回智能画报"
          onClick={() => go('briefing')}
        >
          <DreamcoreLogo />
          <span className="nav-label" aria-hidden="true">
            Mengine 梦擎工作空间
          </span>
        </button>
      </div>
      <nav aria-label="主导航">
        {nav.map(({ path, label, Icon }) => {
          const isChat = path === 'conversations';
          const active = isChat
            ? ui.conversationOpen || ui.route.split('/')[0] === 'space'
            : ui.route.split('/')[0] === path.split('/')[0];
          const isExpanded = expanded === path;
          return (
            <NavIconButton
              key={path}
              label={label}
              Icon={Icon}
              active={active}
              expanded={isExpanded}
              interaction={interaction(path)}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (isChat) {
                  dismiss();
                  ui.openConversationPage();
                } else go(path);
              }}
            />
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
