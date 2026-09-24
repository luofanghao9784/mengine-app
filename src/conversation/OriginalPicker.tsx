import { useState } from 'react';
import type { TaskOriginal } from '../../contracts/public-api/conversation';
import { materialClient } from '../material/client';
import { Button, Field, Modal } from '../shared/ui';
import { Failure, Loading, Pager, useRemote } from '../shared/admin';

export function OriginalPicker({
  tenant,
  space,
  selected,
  onSelect,
  onClose,
}: {
  tenant: string;
  space: string;
  selected: TaskOriginal[];
  onSelect: (file: TaskOriginal) => void;
  onClose: () => void;
}) {
  const [folder, setFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [document, setDocument] = useState<string>();
  const [versionPage, setVersionPage] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const files = useRemote(
    (signal) => materialClient.list(tenant, space, folder, query, page * 24, signal),
    [tenant, space, folder, query, page, attempt],
  );
  const versions = useRemote(
    async (signal) =>
      document ? materialClient.detail(tenant, space, document, versionPage * 20, signal) : null,
    [tenant, space, document, versionPage, attempt],
  );
  const changeFolder = (id: string | null) => {
    setFolder(id);
    setPage(0);
    setQuery('');
  };
  return (
    <Modal title="选择文件版本" onClose={onClose}>
      <p className="muted">
        本次最多 3 份文件，单份 256 KiB、合计 512 KiB。所选版本固定用于本次任务；上传新版本不会自动替换。
      </p>
      {document ? (
        <>
          <Button onClick={() => setDocument(undefined)}>返回文件列表</Button>
          {versions.error ? (
            <Failure error={versions.error} retry={() => setAttempt((x) => x + 1)} />
          ) : !versions.value ? (
            <Loading />
          ) : (
            <>
              <h3>{versions.value.document.name}</h3>
              <div className="original-picker-list">
                {versions.value.versions.map((version) => {
                  const other = selected.filter((f) => f.materialId !== document);
                  const fits =
                    other.length < 3 &&
                    version.sizeBytes <= 262144 &&
                    other.reduce((n, f) => n + f.bytes, 0) + version.sizeBytes <= 524288;
                  return (
                    <div key={version.id}>
                      <span>
                        v{version.number} · {version.sizeBytes.toLocaleString()} 字节
                      </span>
                      <Button
                        disabled={!fits}
                        onClick={() => {
                          onSelect({
                            materialId: document,
                            versionId: version.id,
                            filename: version.filename,
                            version: version.number,
                            bytes: version.sizeBytes,
                            sha256: version.sha256,
                            read: false,
                          });
                          onClose();
                        }}
                      >
                        选择 v{version.number}
                      </Button>
                      {!fits && <small>超过本次文件数量或大小上限</small>}
                    </div>
                  );
                })}
              </div>
              <Pager page={versionPage} next={versions.value.hasMore} onPage={setVersionPage} />
            </>
          )}
        </>
      ) : (
        <>
          <Field label="查找文件">
            <input
              aria-label="查找文件"
              value={query}
              maxLength={180}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="按文件名搜索当前空间"
            />
          </Field>
          <nav className="original-picker-path" aria-label="文件夹位置">
            <Button onClick={() => changeFolder(null)}>当前空间</Button>
            {files.value?.trail.map((c) => (
              <Button key={c.id} onClick={() => changeFolder(c.id)}>
                {c.name}
              </Button>
            ))}
          </nav>
          {files.error ? (
            <Failure error={files.error} retry={() => setAttempt((x) => x + 1)} />
          ) : !files.value ? (
            <Loading />
          ) : (
            <>
              <div className="original-picker-list">
                {files.value.items.map((f) => (
                  <Button
                    key={f.id}
                    onClick={() => {
                      if (f.kind === 'FOLDER') changeFolder(f.id);
                      else {
                        setDocument(f.id);
                        setVersionPage(0);
                      }
                    }}
                  >
                    {f.kind === 'FOLDER' ? '文件夹：' : ''}
                    {f.name}
                    {f.kind === 'DOCUMENT' ? ` · v${f.version}` : ''}
                  </Button>
                ))}
              </div>
              {!files.value.items.length && <p className="muted">没有找到文件，可先到资料库上传。</p>}
              <Pager page={page} next={files.value.hasMore} onPage={setPage} />
            </>
          )}
        </>
      )}
    </Modal>
  );
}
