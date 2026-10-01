import { useEffect, useState } from 'react';
import { IdentityError } from '../identity/client';
import { ArrowLeft, Check, FileText, Folder, Search } from 'lucide-react';
import type { SourceSubmission } from '../../contracts/public-api/source';
import { materialClient } from '../material/client';
import { Button, Badge } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';
export type SourceVersion = SourceSubmission['versions'][number];
export function SourceVersionPicker({
  tenant,
  workspace,
  selected,
  onChange,
  disabled = false,
  verification,
  onDenied,
}: {
  tenant: string;
  workspace: string;
  selected: SourceVersion[];
  onChange: (versions: SourceVersion[]) => void;
  disabled?: boolean;
  verification?: unknown;
  onDenied?: (error: unknown) => void;
}) {
  const [folder, setFolder] = useState<string | null>(null),
    [material, setMaterial] = useState<string>();
  const [draft, setDraft] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [versionPage, setVersionPage] = useState(0),
    [attempt, setAttempt] = useState(0);
  const refresh = () => setAttempt((n) => n + 1);
  const entries = useRemote(
    (signal) => materialClient.list(tenant, workspace, folder, query, page * 24, signal),
    [tenant, workspace, folder, query, page, attempt, verification],
  );
  const versions = useRemote(
    (signal) =>
      material
        ? materialClient.detail(tenant, workspace, material, versionPage * 20, signal)
        : Promise.resolve(null),
    [tenant, workspace, material, versionPage, attempt, verification],
  );
  useEffect(() => {
    const error = entries.error || versions.error;
    if (error instanceof IdentityError && [401, 403, 404].includes(error.status)) onDenied?.(error);
  }, [entries.error, versions.error, onDenied]);
  const chooseFolder = (next: string | null) => {
    setFolder(next);
    setPage(0);
    setQuery('');
    setDraft('');
  };
  const toggle = (version: SourceVersion) =>
    onChange(
      selected.some((v) => v.versionId === version.versionId)
        ? selected.filter((v) => v.versionId !== version.versionId)
        : [...selected, version],
    );
  return (
    <section className="source-version-picker" aria-label="选择来源固定版本">
      <div className="source-picker-heading">
        <strong>从本空间选择固定版本</strong>
        <Badge>已选 {selected.length} / 100</Badge>
      </div>
      <p className="source-note">
        只关联已上传原件，不上传新文件或改变其权限。选择旧版本后，资料后续更新不会替换本次声明。
      </p>
      {selected.length > 0 && (
        <ul className="source-selected-versions">
          {selected.map((v) => (
            <li key={v.versionId}>
              <span>
                {v.filename} · v{v.number}
              </span>
              <Button
                variant="ghost"
                disabled={disabled}
                aria-label={`移除 ${v.filename} v${v.number}`}
                onClick={() => toggle(v)}
              >
                移除
              </Button>
            </li>
          ))}
        </ul>
      )}
      {entries.error || versions.error ? (
        <Failure error={entries.error || versions.error} retry={refresh} />
      ) : material ? (
        <>
          <Button variant="ghost" icon={ArrowLeft} disabled={disabled} onClick={() => setMaterial(undefined)}>
            返回资料列表
          </Button>
          {!versions.value ? (
            <Loading />
          ) : (
            <>
              <h4>{versions.value.document.name}</h4>
              <ul className="source-picker-list">
                {versions.value.versions.map((version) => {
                  const chosen = selected.some((v) => v.versionId === version.id);
                  return (
                    <li key={version.id}>
                      <label className="source-version-choice">
                        <input
                          type="checkbox"
                          checked={chosen}
                          disabled={disabled || (!chosen && selected.length >= 100)}
                          onChange={() =>
                            toggle({
                              materialId: material,
                              versionId: version.id,
                              number: version.number,
                              filename: version.filename,
                              sha256: version.sha256,
                            })
                          }
                        />
                        <span>
                          <strong>
                            {version.filename} · v{version.number}
                          </strong>
                          <small>
                            {new Date(version.createdAt).toLocaleString('zh-CN')} ·{' '}
                            {version.sizeBytes.toLocaleString('zh-CN')} B
                          </small>
                          <small className="source-hash">SHA-256：{version.sha256}</small>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <Pager page={versionPage} next={versions.value.hasMore} onPage={setVersionPage} />
            </>
          )}
        </>
      ) : (
        <>
          <div className="source-picker-search">
            <input
              aria-label="查找补交资料"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={disabled}
              placeholder="搜索本空间资料名称"
              maxLength={100}
            />
            <Button
              icon={Search}
              disabled={disabled}
              onClick={() => {
                setQuery(draft.trim());
                setPage(0);
              }}
            >
              查找资料
            </Button>
          </div>
          {!entries.value ? (
            <Loading />
          ) : (
            <>
              <nav className="source-picker-trail" aria-label="补交资料目录">
                <Button variant="ghost" disabled={disabled} onClick={() => chooseFolder(null)}>
                  空间根目录
                </Button>
                {entries.value.trail.map((part) => (
                  <Button
                    key={part.id}
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => chooseFolder(part.id)}
                  >
                    {part.name}
                  </Button>
                ))}
              </nav>
              <ul className="source-picker-list">
                {entries.value.items.map((entry) => (
                  <li key={entry.id}>
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      icon={
                        entry.kind === 'FOLDER'
                          ? Folder
                          : selected.some((v) => v.materialId === entry.id)
                            ? Check
                            : FileText
                      }
                      onClick={() => {
                        if (entry.kind === 'FOLDER') chooseFolder(entry.id);
                        else {
                          setMaterial(entry.id);
                          setVersionPage(0);
                        }
                      }}
                    >
                      <span>
                        <strong>{entry.name}</strong>
                        <small>
                          {entry.kind === 'FOLDER' ? '打开文件夹' : `查看版本 · 当前 v${entry.version}`}
                          {query ? ` · ${entry.path.join(' / ')}` : ''}
                        </small>
                      </span>
                    </Button>
                  </li>
                ))}
                {!entries.value.items.length && (
                  <li className="source-empty">没有符合条件的资料。请先在资料库上传原件。</li>
                )}
              </ul>
              <Pager page={page} next={entries.value.hasMore} onPage={setPage} />
            </>
          )}
        </>
      )}
    </section>
  );
}
