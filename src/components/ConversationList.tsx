import { useLayoutEffect, useRef, useState } from 'react';
import { Plus, Folder, ChevronRight, ChevronDown } from 'lucide-react';
import { useDemo, useUI } from '../store';
import { IconButton } from './ui';

export function ConversationList({ onSelect }: { onSelect?: () => void }) {
  const { state } = useDemo();
  const ui = useUI();
  const [folded, setFolded] = useState<string[]>(ui.conversationListState.current.folded);
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = ui.conversationListState.current.scrollTop;
  }, []);
  const toggleFolder = (id: string) => {
    const next = folded.includes(id) ? folded.filter((item) => item !== id) : [...folded, id];
    ui.conversationListState.current.folded = next;
    setFolded(next);
  };
  const go = (path: string) => {
    onSelect?.();
    ui.go(path);
  };
  const open = (kind: 'space') => {
    onSelect?.();
    ui.open({ kind });
  };
  const chats = (space: string) =>
    state.chats
      .filter((c) => !c.archived && c.space === space)
      .map((c) => (
        <button
          key={c.id}
          title={c.title}
          className={`thread-link ${ui.route === `chat/${c.id}` ? 'active' : ''}`}
          aria-current={ui.route === `chat/${c.id}` ? 'page' : undefined}
          onClick={() => {
            go(`chat/${c.id}`);
          }}
        >
          <span>{c.title}</span>
        </button>
      ));
  return (
    <>
      <div className="conversation-list-tools">
        <button className="new-conversation" onClick={() => go('home')}>
          <Plus size={17} />
          新建会话
        </button>
      </div>
      <div
        className="sidebar-scroll"
        ref={scroll}
        onScroll={(event) => {
          ui.conversationListState.current.scrollTop = event.currentTarget.scrollTop;
        }}
      >
        <div className="nav-section">
          <span>未归入空间</span>
        </div>
        {chats('none').length ? chats('none') : <div className="sidebar-hint">从一个想法开始</div>}
        <section aria-label="工作空间">
          <div className="nav-section">
            <span>工作空间</span>
            <IconButton icon={Plus} label="新建工作空间" onClick={() => open('space')} />
          </div>
          {state.spaces.map((space) => (
            <div className="space-group" key={space.id}>
              <div className={`space-link ${ui.route === `space/${space.id}` ? 'active' : ''}`}>
                <button
                  className="fold-button"
                  aria-label={`${folded.includes(space.id) ? '展开' : '折叠'}${space.name}`}
                  aria-expanded={!folded.includes(space.id)}
                  onClick={() => toggleFolder(space.id)}
                >
                  {folded.includes(space.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                <button title={space.name} onClick={() => go(`space/${space.id}`)}>
                  <Folder size={16} strokeWidth={1.6} />
                  <span>{space.name}</span>
                </button>
              </div>
              {!folded.includes(space.id) && (
                <div className="space-threads">
                  {chats(space.id).length ? (
                    chats(space.id)
                  ) : (
                    <button className="thread-link faint" onClick={() => go(`home/${space.id}`)}>
                      <Plus size={14} />
                      在这里开始工作
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
