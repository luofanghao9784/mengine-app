import { useRef, type ReactNode } from 'react';
import { Grid2X2, List, Search, X } from 'lucide-react';
import { IconButton } from '../shared/ui';
import './library-toolbar.css';

export function LibraryToolbar({
  children,
  query,
  onQuery,
  onSearch,
  onClear,
  layout,
  onLayout,
}: {
  children?: ReactNode;
  query: string;
  onQuery: (query: string) => void;
  onSearch: () => void;
  onClear: () => void;
  layout: 'cards' | 'list';
  onLayout: (layout: 'cards' | 'list') => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  return (
    <div className="material-toolbar library-toolbar">
      {children}
      <div className="material-controls library-controls">
        <form
          className="library-search"
          role="search"
          aria-label="资料搜索"
          onSubmit={(event) => {
            event.preventDefault();
            if (!composing.current) onSearch();
          }}
        >
          <IconButton icon={Search} label="搜索资料" type="submit" />
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            aria-label="搜索资料名称或正文"
            placeholder="搜索资料"
            value={query}
            maxLength={180}
            onChange={(event) => onQuery(event.target.value)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
          />
          {!!query && (
            <IconButton
              icon={X}
              label="清空搜索"
              onClick={() => {
                onClear();
                input.current?.focus();
              }}
            />
          )}
        </form>
        <div className="library-view-switch" role="group" aria-label="资料显示方式">
          <IconButton
            icon={Grid2X2}
            label="卡片视图"
            aria-pressed={layout === 'cards'}
            onClick={() => onLayout('cards')}
          />
          <IconButton
            icon={List}
            label="列表视图"
            aria-pressed={layout === 'list'}
            onClick={() => onLayout('list')}
          />
        </div>
      </div>
    </div>
  );
}
