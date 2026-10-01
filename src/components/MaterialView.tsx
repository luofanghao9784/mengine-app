import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Maximize2,
  X,
  Folder,
  Pencil,
  Download,
  ArrowUpRight,
  Check,
  FileText,
  Info,
  MessageSquare,
} from 'lucide-react';
import { useDemo, useUI } from '../store';
import { canEdit, latest, activity } from '../model';
import { canReadMaterial, canManageFolder, locationNames } from '../libraryModel';
import { Badge, Button, DocumentText, IconButton } from './ui';
import { SourceLinks, SourceImage } from './SourceDetails';
import { MaterialSharing } from './MaterialSharing';

type ReaderProps = {
  id: string;
  initialVersionId?: string;
  versionRequest?: number;
  initialTab?: string;
  compact?: boolean;
  onClose?: () => void;
  onPropertiesChange?: (open: boolean) => void;
  onExpand?: () => void;
  onNavigate?: () => void;
};

export function MaterialPreview(props: ReaderProps) {
  const [expanded, setExpanded] = useState(false);
  const [host] = useState(() => document.createElement('div'));
  const slot = useRef<HTMLDivElement>(null);
  const fullscreen = useRef<HTMLDialogElement>(null);
  const readingPosition = useRef(0);
  const propertiesOpen = useRef(false);
  const deckHeaderAttributes = useRef<[string, string | null][]>([]);
  const expand = () => {
    readingPosition.current = host.querySelector('.reader-scroll')?.scrollTop || 0;
    setExpanded(true);
  };
  useLayoutEffect(() => {
    const dialog = fullscreen.current;
    const target = expanded ? dialog : slot.current;
    if (!dialog || !target) return;
    const reader = host.querySelector<HTMLElement>('.reader-scroll');
    const position = expanded ? reader?.scrollTop || 0 : readingPosition.current;
    // Move a stable portal host, retaining the actual reader, version and property state.
    // A second reader (or changing portal targets) would remount the document.
    host.className = 'material-reader-host';
    target.appendChild(host);
    const header = host.querySelector('.reader-header');
    if (expanded) {
      deckHeaderAttributes.current = ['tabindex', 'data-deck-draggable', 'title'].map((name) => [
        name,
        header?.getAttribute(name) ?? null,
      ]);
      deckHeaderAttributes.current.forEach(([name]) => header?.removeAttribute(name));
      dialog.showModal();
      host.querySelector<HTMLButtonElement>('[aria-label="关闭资料视窗"]')?.focus({ preventScroll: true });
    } else {
      dialog.close();
      deckHeaderAttributes.current.forEach(([name, value]) => {
        if (value !== null) header?.setAttribute(name, value);
      });
      if (deckHeaderAttributes.current.length)
        host.querySelector<HTMLButtonElement>('[aria-label="展开资料详情"]')?.focus({ preventScroll: true });
    }
    reader?.scrollTo({ top: position, behavior: 'instant' });
  }, [expanded, host]);
  useEffect(() => {
    if (!expanded) props.onPropertiesChange?.(propertiesOpen.current);
  }, [expanded]);
  return (
    <>
      <div ref={slot} className="material-reader-slot" />
      {createPortal(
        <dialog
          ref={fullscreen}
          className="reader-fullscreen-dialog"
          aria-label="资料全屏阅读"
          onCancel={(event) => {
            event.preventDefault();
            setExpanded(false);
          }}
        />,
        document.body,
      )}
      {createPortal(
        <MaterialReader
          {...props}
          compact={!expanded}
          onExpand={expand}
          onClose={expanded ? () => setExpanded(false) : props.onClose}
          onNavigate={() => setExpanded(false)}
          onPropertiesChange={(open) => {
            propertiesOpen.current = open;
            if (!expanded) props.onPropertiesChange?.(open);
          }}
        />,
        host,
      )}
    </>
  );
}

export function MaterialDetails(props: ReaderProps) {
  return (
    <div className="material-details">
      <MaterialReader {...props} />
    </div>
  );
}

// The library, conversation deck and expanded detail use the same document and version state.
export function MaterialReader({
  id,
  initialVersionId,
  versionRequest,
  initialTab = 'content',
  compact = false,
  onClose,
  onPropertiesChange,
  onExpand,
  onNavigate,
}: ReaderProps) {
  const { state, change } = useDemo();
  const ui = useUI();
  const supportId = useId();
  const root = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [versionId, setVersionId] = useState(initialVersionId);
  const [panel, setPanel] = useState(initialTab === 'content' ? '' : initialTab);
  const doc = state.materials.find((d) => d.id === id && canReadMaterial(state, d));
  useEffect(() => {
    setVersionId(initialVersionId);
  }, [id, initialVersionId, versionRequest]);
  const propertiesCallback = useRef(onPropertiesChange);
  propertiesCallback.current = onPropertiesChange;
  useEffect(() => {
    propertiesCallback.current?.(!!panel);
  }, [!!panel]);
  const closeProperties = () => {
    setPanel('');
    root.current?.querySelector<HTMLButtonElement>('[aria-label="资料属性"]')?.focus();
  };
  useEffect(() => {
    if (!panel) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        Array.from(document.querySelectorAll('dialog[open]')).some(
          (dialog) => !dialog.contains(root.current),
        ) ||
        root.current?.closest('[inert]')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      closeProperties();
    };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [panel]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
  }, [id, versionId]);
  if (!doc) return <div className="reader-unavailable">资料暂不可用，或你没有查看权限。</div>;
  const current = latest(doc);
  const version = versionId ? doc.versions.find((v) => v.id === versionId) : current;
  const chooseVersion = (value: string) => setVersionId(value);
  const download = () => {
    if (!version) return;
    const url = URL.createObjectURL(
      new Blob(['# ' + doc.title + '\n\n' + version.content], { type: 'text/markdown;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = doc.title + '-v' + version.number + '.md';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ui.toast('已导出演示文档');
  };
  const relations = doc.relations
    .map((ref) => state.materials.find((material) => material.id === ref && canReadMaterial(state, material)))
    .filter((material) => !!material);
  const support = (
    <aside id={supportId} className="reader-support" aria-label="资料属性侧栏">
      <div className="reader-support-heading">
        <h2>资料属性</h2>
        <IconButton icon={X} label="收起资料属性" onClick={closeProperties} />
      </div>
      <div className="tabs reader-info-tabs" role="tablist" aria-label="资料详情">
        {[
          ['attributes', '基本信息'],
          ['versions', '版本记录'],
          ['sharing', '共享与权限'],
          ['relations', '关联资料'],
        ].map(([value, label]) => (
          <button
            role="tab"
            id={`${supportId}-${value}`}
            aria-controls={`${supportId}-panel`}
            aria-selected={panel === value}
            tabIndex={panel === value ? 0 : -1}
            key={value}
            onClick={() => setPanel(value)}
            onKeyDown={(event) => {
              const tabs = Array.from(
                event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
              );
              const index = tabs.indexOf(event.currentTarget);
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              tabs[next].click();
              tabs[next].focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="reader-support-scroll"
        role="tabpanel"
        id={`${supportId}-panel`}
        aria-labelledby={`${supportId}-${panel}`}
      >
        {panel === 'attributes' && (
          <>
            <dl className="reader-properties">
              <dt>当前查看版本</dt>
              <dd>
                <select
                  aria-label="查看资料版本"
                  value={version?.id || ''}
                  onChange={(event) => chooseVersion(event.target.value)}
                >
                  {!version && <option value="">引用版本不可用</option>}
                  {[...doc.versions].reverse().map((item) => (
                    <option key={item.id} value={item.id}>
                      v{item.number}
                      {item.id === current.id ? ' · 最新' : ''}
                      {doc.confirmed === item.id ? ' · 已确认' : ' · 待确认'}
                    </option>
                  ))}
                </select>
              </dd>
              <dt>简介索引</dt>
              <dd>{doc.summary}</dd>
              <dt>资料路径</dt>
              <dd>{locationNames(state, doc.space, doc.folderId).join(' / ')}</dd>
              <dt>查看范围</dt>
              <dd>{doc.visibility}</dd>
              <dt>维护人</dt>
              <dd>{doc.owner}</dd>
              <dt>资料类型</dt>
              <dd>{doc.type}</dd>
              <dt>分类</dt>
              <dd>{doc.tags.join(' / ') || '待整理'}</dd>
              <dt>资料身份</dt>
              <dd className="reader-identity">{doc.id}</dd>
              <dt>索引对应版本</dt>
              <dd>v{current.number}</dd>
              <dt>使用状态</dt>
              <dd>
                <select
                  aria-label="资料使用状态"
                  value={doc.status}
                  disabled={!canEdit(state, doc.space)}
                  onChange={(event) => {
                    const next = event.target.value as typeof doc.status;
                    ui.open({
                      kind: 'confirm',
                      title: '调整资料使用状态',
                      text: '将「' + doc.title + '」标记为' + next + '。原内容与版本保留。',
                      onConfirm: () => {
                        change((s) => {
                          s.materials.find((material) => material.id === id)!.status = next;
                          activity(s, doc.space, '将「' + doc.title + '」标记为' + next);
                        });
                        ui.toast('资料状态已更新');
                      },
                    });
                  }}
                >
                  <option>使用中</option>
                  <option>已过期</option>
                  <option>已归档</option>
                </select>
              </dd>
            </dl>
            <div className="reader-manage">
              {canManageFolder(state, doc.space) && (
                <Button icon={Folder} onClick={() => ui.open({ kind: 'move-material', id })}>
                  移动到文件夹
                </Button>
              )}
              <Button icon={Download} disabled={!version} onClick={download}>
                导出文档
              </Button>
            </div>
          </>
        )}
        {panel === 'versions' && (
          <>
            <div className="reader-version-list">
              {[...doc.versions].reverse().map((item) => (
                <button
                  key={item.id}
                  className={version?.id === item.id ? 'selected' : ''}
                  onClick={() => chooseVersion(item.id)}
                >
                  <span className="between">
                    <strong>v{item.number}</strong>
                    {doc.confirmed === item.id && <Badge blue>确认版</Badge>}
                  </span>
                  <span>{item.note}</span>
                  <small>{item.date}</small>
                </button>
              ))}
            </div>
            {version && canEdit(state, doc.space) && (
              <Button
                className="full"
                icon={Check}
                disabled={doc.confirmed === version.id}
                onClick={() => {
                  change((s) => {
                    s.materials.find((material) => material.id === id)!.confirmed = version.id;
                    activity(s, doc.space, '确认了「' + doc.title + '」v' + version.number);
                  });
                  ui.toast('已标记为确认版本');
                }}
              >
                {doc.confirmed === version.id ? '当前确认版' : '标记为确认版'}
              </Button>
            )}
          </>
        )}
        {panel === 'sharing' && (
          <div className="reader-sharing">
            <MaterialSharing id={id} />
          </div>
        )}
        {panel === 'relations' &&
          (relations.length ? (
            relations.map((material) => (
              <button
                className="reader-related"
                key={material.id}
                onClick={() => {
                  if (ui.conversationOpen) {
                    onNavigate?.();
                    ui.preview(material.id);
                    setPanel('');
                  } else ui.go('library/' + material.space + '/' + material.id);
                }}
              >
                <FileText size={18} />
                <span>
                  {material.title}
                  <small>{locationNames(state, material.space, material.folderId).join(' / ')}</small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))
          ) : (
            <p className="subtle">暂无可查看的关联资料。</p>
          ))}
      </div>
    </aside>
  );
  return (
    <div
      ref={root}
      className={
        'material-reader ' + (compact ? 'reader-compact' : 'reader-expanded') + (panel ? ' has-info' : '')
      }
    >
      <div className="reader-main preview-pane">
        <header className="reader-header preview-header">
          <h2 title={doc.title}>{doc.title}</h2>
          <div className="row reader-header-tools">
            {!compact && (
              <IconButton
                icon={Pencil}
                label={canEdit(state, doc.space) ? '编辑资料' : '创建个人修订稿'}
                onClick={() => ui.open({ kind: 'edit', id })}
              />
            )}
            <IconButton
              icon={Info}
              label="资料属性"
              aria-expanded={!!panel}
              aria-controls={supportId}
              onClick={() => setPanel(panel ? '' : 'attributes')}
            />
            {compact && onExpand && <IconButton icon={Maximize2} label="展开资料详情" onClick={onExpand} />}
            {onClose && (
              <IconButton icon={X} label={compact ? '关闭成果预览' : '关闭资料视窗'} onClick={onClose} />
            )}
          </div>
        </header>
        <div className="reader-workspace">
          <div className="reader-document">
            <div ref={scroll} className="reader-scroll preview-scroll">
              <nav className="preview-location" aria-label="资料所属位置">
                <Folder size={15} />
                {locationNames(state, doc.space, doc.folderId).join(' / ')}
              </nav>
              <article className="reader-paper document-paper">
                <h1>{doc.title}</h1>
                <div className="document-meta">
                  <span>{doc.owner}</span>
                  <span>{version?.date}</span>
                </div>
                <SourceLinks links={doc.sourceLinks} />
                <SourceImage key={doc.id} photo={doc.photo} />
                {version ? (
                  <DocumentText text={version.content} />
                ) : (
                  <p className="reader-unavailable">该引用的版本已不可用，请明确选择其他版本后继续。</p>
                )}
              </article>
            </div>
            <footer className="reader-footer preview-footer">
              {version && version.id !== current.id && (
                <p className="reader-action-note">
                  编辑和共享使用最新版本 v{current.number}；提问使用当前查看版本。
                </p>
              )}
              <Button
                className="reader-ask"
                icon={MessageSquare}
                variant="primary"
                disabled={!version}
                onClick={() => {
                  if (version) {
                    onNavigate?.();
                    ui.askMaterial(id, version.id);
                  }
                }}
              >
                基于资料提问
              </Button>
            </footer>
          </div>
          {panel && support}
        </div>
      </div>
    </div>
  );
}
