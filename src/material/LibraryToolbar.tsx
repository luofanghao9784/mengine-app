import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Grid2X2, List, Search, X, FolderPlus, Trash2 } from 'lucide-react';
import { Button, IconButton, PageActions } from '../shared/ui';
import { MoreActions } from '../shared/MoreActions';
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
  // 手机窄屏只显示搜索图标，点开后搜索框盖住标题那一行；没有搜索内容时离开即收起。
  const compact = useCompact();
  const [open, setOpen] = useState(false);
  const collapsed = compact && !open && !query;
  return (
    <form
      className="library-search"
      role="search"
      aria-label={label === '搜索资料' ? '资料搜索' : label}
      data-collapsed={collapsed || undefined}
      data-open={(compact && !collapsed) || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!composing.current) onSearch();
      }}
      onBlur={(event) => {
        if (!query && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <IconButton
        icon={Search}
        label={label}
        type="submit"
        disabled={disabled}
        onClick={(event) => {
          if (!collapsed) return;
          event.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => input.current?.focus());
        }}
      />
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
      {compact && !collapsed && !query && (
        <IconButton icon={X} label="收起搜索" disabled={disabled} onClick={() => setOpen(false)} />
      )}
    </form>
  );
}

const COMPACT = '(max-width: 560px)';
function useCompact() {
  const [compact, setCompact] = useState(() => matchMedia(COMPACT).matches);
  useEffect(() => {
    const query = matchMedia(COMPACT);
    const change = () => setCompact(query.matches);
    change();
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return compact;
}

export function LibraryToolbar({
  inHeader = false,
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
  inHeader?: boolean;
  layout: 'cards' | 'list';
  onLayout: (layout: 'cards' | 'list') => void;
  onCreateFolder?: () => void;
  onMaintenance?: () => void;
}) {
  // 手机窄屏：新建文件夹、回收站和视图切换收进“更多操作”，顶部只留一行。
  const compact = useCompact();
  const toolbar = (
    <div className="material-toolbar library-toolbar">
      {children}
      <div className="material-controls library-controls">
        {extraActions}
        {compact && (
          <MoreActions>
            {onCreateFolder && (
              <Button variant="ghost" icon={FolderPlus} onClick={onCreateFolder}>
                新建文件夹
              </Button>
            )}
            {onMaintenance && (
              <Button variant="ghost" icon={Trash2} onClick={onMaintenance}>
                回收站
              </Button>
            )}
            <Button
              variant="ghost"
              icon={layout === 'cards' ? List : Grid2X2}
              disabled={disabled}
              onClick={() => onLayout(layout === 'cards' ? 'list' : 'cards')}
            >
              {layout === 'cards' ? '列表视图' : '卡片视图'}
            </Button>
          </MoreActions>
        )}
        {!compact && onCreateFolder && (
          <IconButton icon={FolderPlus} label="新建文件夹" onClick={onCreateFolder} />
        )}
        {!compact && onMaintenance && <IconButton icon={Trash2} label="回收站" onClick={onMaintenance} />}
        <div className="library-view-switch" role="group" aria-label="资料显示方式" hidden={compact}>
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
  return inHeader ? <PageActions placement="header">{toolbar}</PageActions> : toolbar;
}
