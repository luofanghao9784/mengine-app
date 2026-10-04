import { useRef, type ReactNode } from 'react';
import { Grid2X2, List, Search, X, FolderPlus, Trash2 } from 'lucide-react';
import { IconButton } from '../shared/ui';
import './library-toolbar.css';

export function LibrarySearch({
  query,
  onQuery,
  onSearch,
  onClear,
  label = '搜索资料',
  disabled = false,
}: {
  label?: string;
  disabled?: boolean;
  query: string;
  onQuery: (query: string) => void;
  onSearch: () => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  return (
    <form
      className="library-search"
      role="search"
      aria-label={label === '搜索资料' ? '资料搜索' : label}
      onSubmit={(event) => {
        event.preventDefault();
        if (!composing.current) onSearch();
      }}
    >
      <IconButton icon={Search} label={label} type="submit" disabled={disabled} />
      <input
        ref={input}
        type="search"
        disabled={disabled}
        enterKeyHint="search"
        aria-label={label === '搜索资料' ? '搜索资料名称或正文' : label}
        placeholder={label}
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
          disabled={disabled}
          onClick={() => {
            onClear();
            input.current?.focus();
          }}
        />
      )}
    </form>
  );
}

export function LibraryToolbar({
  children,
  layout,
  onLayout,
  onCreateFolder,
  onMaintenance,
  extraActions,
  disabled = false,
}: {
  children?: ReactNode;
  extraActions?: ReactNode;
  disabled?: boolean;
  layout: 'cards' | 'list';
  onLayout: (layout: 'cards' | 'list') => void;
  onCreateFolder?: () => void;
  onMaintenance?: () => void;
}) {
  return (
    <div className="material-toolbar library-toolbar">
      {children}
      <div className="material-controls library-controls">
        {extraActions}
        {onCreateFolder && <IconButton icon={FolderPlus} label="新建文件夹" onClick={onCreateFolder} />}
        {onMaintenance && <IconButton icon={Trash2} label="回收站" onClick={onMaintenance} />}
        <div className="library-view-switch" role="group" aria-label="资料显示方式">
          <IconButton
            icon={Grid2X2}
            label="卡片视图"
            aria-pressed={layout === 'cards'}
            disabled={disabled}
            onClick={() => onLayout('cards')}
          />
          <IconButton
            icon={List}
            label="列表视图"
            aria-pressed={layout === 'list'}
            disabled={disabled}
            onClick={() => onLayout('list')}
          />
        </div>
      </div>
    </div>
  );
}
