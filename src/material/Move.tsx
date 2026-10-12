import { useEffect, useState } from 'react';
import { createIdentityRequest, record, uuid } from '../identity/client';
import { Button, Field, Modal } from '../shared/ui';
import { Loading, SubmitError, useSubmission } from '../shared/admin';
import { useRequestLock } from '../shared/request-guard';
interface Preview {
  fingerprint: string;
  workspaceId: string;
  kind: string;
  objectId: string;
  sourceFolderId: string | null;
  destinationFolderId: string | null;
  destinationName: string;
  inheritDestination: boolean;
  independent: boolean;
  objects: number;
  canConfirm: boolean;
  changes: {
    accountId: string;
    name: string;
    objectId: string;
    objectName: string;
    beforeMask: number;
    afterMask: number;
  }[];
}
const request = createIdentityRequest();
const describe = (mask: number) =>
  !(mask & 1)
    ? '不可查看'
    : `${mask & 2 ? '可编辑' : '仅查看'} · ${mask & 4 ? '可下载' : '不可下载'}${mask & 8 ? ' · 可移动/删除' : ''}`;
const isPreview = (v: unknown): v is Preview =>
  record(v) &&
  typeof v.fingerprint === 'string' &&
  uuid(v.objectId) &&
  typeof v.canConfirm === 'boolean' &&
  Array.isArray(v.changes);
export function LibraryMove({
  tenant,
  workspace,
  id,
  kind,
  name,
  close,
  changed,
}: {
  tenant: string;
  workspace: string;
  id: string;
  kind: 'MATERIAL' | 'FOLDER';
  name: string;
  close: () => void;
  changed: () => void;
}) {
  const [destinations, setDestinations] = useState<{ id: string; name: string }[]>();
  const [destination, setDestination] = useState('');
  const [inherit, setInherit] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const root = `/api/v1/tenants/${tenant}/workspaces/${workspace}/library-moves/${kind}/${id}`;
  const mutation = useSubmission<{
    expectedFingerprint: string;
    destinationFolderId: string | null;
    inheritDestination: boolean;
  }>();
  const locked = mutation.busy || mutation.uncertain;
  useRequestLock(locked);
  useEffect(() => {
    const abort = new AbortController();
    void request(
      root + '/destinations',
      'GET',
      (v): v is { id: string; name: string }[] =>
        Array.isArray(v) && v.every((x) => record(x) && uuid(x.id) && typeof x.name === 'string'),
      undefined,
      abort.signal,
    )
      .then(setDestinations)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '目录读取失败');
      });
    return () => abort.abort();
  }, [root]);
  const inspect = async () => {
    setLoading(true);
    setError('');
    setPreview(undefined);
    try {
      setPreview(
        await request(root + '/preview', 'POST', isPreview, {
          destinationFolderId: destination || null,
          inheritDestination: inherit,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览失败');
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal
      title={`移动资料 · ${name}`}
      wide
      onClose={() => {
        if (!locked && !loading) close();
      }}
    >
      <p>选择当前空间内的目标目录。文件身份、历史版本和单独授权保留；继承权限变化需核对后确认。</p>
      {error && (
        <p role="alert" className="access-alert">
          {error}
        </p>
      )}
      {!destinations ? (
        <Loading />
      ) : (
        <>
          <Field label="目标目录">
            <select
              disabled={locked || loading}
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                setPreview(undefined);
              }}
            >
              <option value="">空间根目录</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <label>
            <input
              type="checkbox"
              disabled={locked || loading}
              checked={inherit}
              onChange={(e) => {
                setInherit(e.target.checked);
                setPreview(undefined);
              }}
            />
            将此对象的独立范围改为继承目标目录（单独授权保留）
          </label>
          <Button disabled={locked || loading} onClick={() => void inspect()}>
            {loading ? '正在比较…' : '预览权限变化'}
          </Button>
          {preview && (
            <section aria-label="移动权限变化">
              <p>
                目标：{preview.destinationName}；包含 {preview.objects} 个文件或文件夹。
              </p>
              <p>
                {preview.independent && !inherit ? '当前独立范围将保留。' : '默认授权将随目标目录计算。'}{' '}
                单独授权继续生效。
              </p>
              {preview.changes.length ? (
                <div style={{ maxHeight: '40vh', overflow: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>成员</th>
                        <th>资料</th>
                        <th>移动前</th>
                        <th>移动后</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.changes.map((c) => (
                        <tr key={c.accountId + c.objectId}>
                          <td>{c.name}</td>
                          <td>{c.objectName}</td>
                          <td>{describe(c.beforeMask)}</td>
                          <td>{describe(c.afterMask)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>
                  {preview.canConfirm
                    ? '当前人员的有效权限没有变化。'
                    : '此移动涉及授权变化，请由本空间管理员处理。'}
                </p>
              )}
              {!preview.canConfirm && <p role="alert">你没有调整权限范围的管理资格，不能提交此次移动。</p>}
              <SubmitError error={mutation.error} uncertain={mutation.uncertain} />
              <div className="modal-actions">
                <Button disabled={locked} onClick={close}>
                  取消移动
                </Button>
                <Button
                  disabled={mutation.busy || (!mutation.uncertain && !preview.canConfirm)}
                  onClick={() =>
                    void mutation.submit(
                      {
                        expectedFingerprint: preview.fingerprint,
                        destinationFolderId: preview.destinationFolderId,
                        inheritDestination: preview.inheritDestination,
                      },
                      async (body, requestId) => {
                        await request(
                          root,
                          'POST',
                          (v): v is { objectId: string } => record(v) && v.objectId === id,
                          { ...body, requestId },
                        );
                        changed();
                        close();
                      },
                    )
                  }
                >
                  {mutation.uncertain ? '重试同一次移动' : '确认范围并移动'}
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </Modal>
  );
}
