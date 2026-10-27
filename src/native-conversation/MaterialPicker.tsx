import { useEffect, useState } from 'react';
import { ChevronRight, Folder, Search, Upload } from 'lucide-react';
import type { TaskOriginal } from '../../contracts/public-api/conversation';
import type { MaterialEntry, MaterialVersion } from '../../contracts/public-api/material';
import { materialClient } from '../material/client';
import { Failure, useRemote } from '../shared/admin';
import { Button, Modal } from '../shared/ui';
import './native-conversation.css';

type Pick = TaskOriginal & { versions?: MaterialVersion[]; error?: string };
const PAGE = 24;

const kind = (name: string) => {
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : '';
  return ext === 'XLSX' || ext === 'CSV' ? 'XLS' : ext === 'JPEG' ? 'JPG' : ext.slice(0, 4) || '文件';
};
const size = (bytes: number | null) =>
  bytes == null
    ? ''
    : bytes < 1024
      ? `${bytes} B`
      : bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(1)} KB`
        : `${(bytes / 1048576).toFixed(1)} MB`;
const date = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  timeZone: 'Asia/Shanghai',
});
const day = (iso: string) => {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? date.format(at) : '';
};

/**
 * 添加资料：一个弹窗里浏览或搜索资料库并多选，默认用最新版本；文件有多个版本时才出现版本选择。
 * 本地上传等平台提供会话附件接口（B7）后开放，在此之前按钮不可用并说明原因。
 */
export function MaterialPicker({
  tenant,
  spaces,
  initialSpace,
  selected,
  max,
  uploadUnavailable,
  onConfirm,
  onClose,
}: {
  tenant: string;
  spaces: { id: string; name: string }[];
  initialSpace: string;
  selected: TaskOriginal[];
  max: number;
  /** Why uploading is not offered yet; when set the upload control is shown disabled with this reason. */
  uploadUnavailable?: string;
  onConfirm: (files: TaskOriginal[]) => void;
  onClose: () => void;
}) {
  const [space, setSpace] = useState(initialSpace);
  const [folder, setFolder] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [picks, setPicks] = useState<Map<string, Pick>>(
    () => new Map(selected.map((f) => [f.materialId, f])),
  );
  // Search waits for a pause in typing; an empty box goes back to browsing.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(typed.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);
  const searching = !!query;
  const page = useRemote(
    (signal) =>
      materialClient.list(tenant, searching ? null : space, searching ? null : folder, query, offset, signal),
    [tenant, space, folder, query, offset, attempt],
  );
  const update = (id: string, change: (p: Pick) => Pick) =>
    setPicks((prior) => {
      const current = prior.get(id);
      return current ? new Map(prior).set(id, change(current)) : prior;
    });
  const toggle = (entry: MaterialEntry) => {
    if (picks.has(entry.id)) {
      setPicks((prior) => {
        const next = new Map(prior);
        next.delete(entry.id);
        return next;
      });
      return;
    }
    if (picks.size >= max) return;
    setPicks((prior) =>
      new Map(prior).set(entry.id, {
        materialId: entry.id,
        workspaceId: entry.workspaceId,
        versionId: '',
        filename: entry.name,
        version: entry.version,
        bytes: entry.sizeBytes ?? 0,
        sha256: '',
        read: false,
      }),
    );
    // The list shows the latest version number but not its id; read the versions once, on choice.
    materialClient.detail(tenant, entry.workspaceId, entry.id).then(
      (detail) => {
        const latest = [...detail.versions].sort((a, b) => b.number - a.number)[0];
        update(entry.id, (p) =>
          latest
            ? { ...p, versions: detail.versions, ...fromVersion(latest) }
            : { ...p, error: '这份资料没有可用的版本' },
        );
      },
      () => update(entry.id, (p) => ({ ...p, error: '读取版本失败，请取消勾选后重试' })),
    );
  };
  const items = (page.value?.items ?? []).filter((e) => e.kind !== 'DRAFT');
  const chosen = [...picks.values()];
  const ready = chosen.length > 0 && chosen.every((p) => p.versionId && !p.error);
  const spaceName = spaces.find((s) => s.id === space)?.name ?? '空间';
  return (
    <Modal title="添加资料" wide className="native-picker" onClose={onClose}>
      <div className="native-picker-tools">
        <label className="native-picker-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="搜索资料"
            placeholder="搜索全部空间的资料"
            value={typed}
            maxLength={180}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        <Button
          icon={Upload}
          disabled={!!uploadUnavailable}
          title={uploadUnavailable}
          aria-describedby={uploadUnavailable ? 'native-picker-upload-note' : undefined}
        >
          <span className="native-picker-upload-label">从电脑上传</span>
        </Button>
      </div>
      {uploadUnavailable && (
        <p id="native-picker-upload-note" className="native-muted native-picker-note">
          {uploadUnavailable}
        </p>
      )}
      <div className="native-picker-body">
        {!searching && (
          <nav className="native-picker-spaces" aria-label="空间">
            {spaces.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-current={s.id === space ? 'true' : undefined}
                // On a phone the spaces scroll sideways; keep the chosen one in view.
                ref={(el) => {
                  if (el && s.id === space) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }}
                onClick={() => {
                  setSpace(s.id);
                  setFolder(null);
                  setOffset(0);
                }}
              >
                {s.name}
              </button>
            ))}
          </nav>
        )}
        <div className="native-picker-files">
          <div className="native-picker-trail">
            {searching ? (
              <span>“{query}”的搜索结果</span>
            ) : (
              <>
                <button type="button" onClick={() => setFolder(null)} disabled={!folder}>
                  {spaceName}
                </button>
                {page.value?.trail.map((t) => (
                  <span key={t.id}>
                    <span aria-hidden="true">/</span>
                    <button type="button" onClick={() => setFolder(t.id)} disabled={t.id === folder}>
                      {t.name}
                    </button>
                  </span>
                ))}
              </>
            )}
          </div>
          {page.error ? (
            <Failure error={page.error} retry={() => setAttempt((x) => x + 1)} />
          ) : !page.value ? (
            <p className="native-muted native-picker-empty">正在读取…</p>
          ) : !items.length ? (
            <p className="native-muted native-picker-empty">
              {searching ? '没有找到相关资料。' : '这里还没有资料。'}
            </p>
          ) : (
            <ul className="native-picker-list">
              {items.map((entry) =>
                entry.kind === 'FOLDER' ? (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="native-picker-row"
                      onClick={() => {
                        setFolder(entry.id);
                        setOffset(0);
                      }}
                    >
                      <span className="native-picker-icon">
                        <Folder size={16} aria-hidden="true" />
                      </span>
                      <span className="native-picker-name">
                        <strong>{entry.name}</strong>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </li>
                ) : (
                  <FileRow
                    key={entry.id}
                    entry={entry}
                    searching={searching}
                    pick={picks.get(entry.id)}
                    full={picks.size >= max}
                    onToggle={() => toggle(entry)}
                    onVersion={(v) => update(entry.id, (p) => ({ ...p, ...fromVersion(v) }))}
                  />
                ),
              )}
            </ul>
          )}
          {(offset > 0 || page.value?.hasMore) && (
            <div className="native-picker-pager">
              <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(offset - PAGE)}>
                上一页
              </Button>
              <Button
                variant="ghost"
                disabled={!page.value?.hasMore}
                onClick={() => setOffset(offset + PAGE)}
              >
                下一页
              </Button>
            </div>
          )}
        </div>
      </div>
      <footer className="native-picker-footer">
        <span>
          已选 {chosen.length} 份<small> · 最多 {max} 份，所选版本固定用于这次对话</small>
        </span>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() => onConfirm(chosen.map(({ versions: _v, error: _e, ...file }) => file))}
        >
          {chosen.length ? `添加 ${chosen.length} 份` : '添加'}
        </Button>
      </footer>
    </Modal>
  );
}

/** Keeps the library name the employee saw; a version's own filename is what was uploaded then. */
const fromVersion = (v: MaterialVersion) => ({
  versionId: v.id,
  version: v.number,
  bytes: v.sizeBytes,
  sha256: v.sha256,
});

function FileRow({
  entry,
  searching,
  pick,
  full,
  onToggle,
  onVersion,
}: {
  entry: MaterialEntry;
  searching: boolean;
  pick?: Pick;
  full: boolean;
  onToggle: () => void;
  onVersion: (v: MaterialVersion) => void;
}) {
  // `path` runs from the space to the file itself; search results show where the file sits.
  const folders = entry.path.slice(0, -1);
  const where = searching
    ? (folders[0] === entry.workspaceName ? folders : [entry.workspaceName, ...folders]).join(' / ')
    : '';
  const meta = [
    where,
    `v${entry.version}`,
    size(entry.sizeBytes),
    day(entry.updatedAt),
    entry.uploadedByName ?? '',
  ].filter(Boolean);
  return (
    <li>
      <div className={`native-picker-row ${pick ? 'is-picked' : ''}`}>
        <input
          type="checkbox"
          id={`pick-${entry.id}`}
          checked={!!pick}
          disabled={!pick && full}
          onChange={onToggle}
        />
        <label htmlFor={`pick-${entry.id}`} className="native-picker-label">
          <span className="native-picker-icon is-file">{kind(entry.name)}</span>
          <span className="native-picker-name">
            <strong>{entry.name}</strong>
            <small className={pick?.error ? 'is-error' : ''}>{pick?.error ?? meta.join(' · ')}</small>
          </span>
        </label>
        {pick?.versions && pick.versions.length > 1 && (
          <select
            aria-label={`${entry.name} 的版本`}
            value={pick.versionId}
            onChange={(e) => {
              const v = pick.versions!.find((x) => x.id === e.target.value);
              if (v) onVersion(v);
            }}
          >
            {[...pick.versions]
              .sort((a, b) => b.number - a.number)
              .map((v, i) => (
                <option key={v.id} value={v.id}>
                  v{v.number}
                  {i === 0 ? ' 最新' : ` · ${day(v.createdAt)}`}
                </option>
              ))}
          </select>
        )}
      </div>
    </li>
  );
}
