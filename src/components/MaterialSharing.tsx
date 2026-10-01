import { useState } from 'react';
import { FileText, Sparkles, ShieldCheck } from 'lucide-react';
import { useDemo, useUI } from '../store';
import { canEdit, latest, publishSnapshot, requestShare, spaceName } from '../model';
import { visibleSpaces } from '../libraryModel';
import { Button, Field } from './ui';
import { FolderSelect } from './LibraryDialogs';

export function MaterialSharing({
  id,
  onDone,
  onCancel,
}: {
  id: string;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const { state, change } = useDemo();
  const ui = useUI();
  const doc = state.materials.find((d) => d.id === id)!;
  const sourceSpace = state.materials.find((d) => d.id === doc.sourceId)?.space;
  const chatSpace = state.chats.find((c) => c.messages.some((m) => m.doc === doc.id))?.space;
  const destinations = visibleSpaces(state);
  const initialTarget =
    [doc.space, sourceSpace, chatSpace, 'sales'].find((id) =>
      destinations.some((space) => space.id === id),
    ) ||
    destinations[0]?.id ||
    '';
  const [target, setTarget] = useState(initialTarget);
  const sharedAt = (space: string) =>
    state.materials.find(
      (d) => d.space === space && (d.id === doc.id || d.id === doc.sourceId || d.sourceId === doc.id),
    );
  const [folder, setFolder] = useState(sharedAt(target)?.folderId || '');
  const [visibility, setVisibility] = useState(sharedAt(target)?.visibility || '空间成员');
  const [error, setError] = useState('');
  const allowed = canEdit(state, target);
  const version = latest(doc);
  return (
    <>
      <div className="share-summary">
        <span className="file-icon">
          <FileText size={23} />
        </span>
        <div>
          <strong>{doc.title}</strong>
          <p>
            v{version.number} · {spaceName(state, doc.space)}
          </p>
        </div>
      </div>
      <Field label="目标工作空间">
        <select
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setFolder(sharedAt(e.target.value)?.folderId || '');
            setVisibility(sharedAt(e.target.value)?.visibility || '空间成员');
          }}
        >
          {!target && (
            <option value="" disabled>
              暂无可发布的工作空间
            </option>
          )}
          {destinations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <FolderSelect space={target} value={folder} onChange={setFolder} />
      <Field label="查看范围">
        <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
          <option>空间成员</option>
          <option>仅空间负责人</option>
        </select>
      </Field>
      <div className="metadata-preview">
        <span className="row">
          <Sparkles size={15} />
          入库属性已准备
        </span>
        <dl>
          <dt>资料名称</dt>
          <dd>{doc.title}</dd>
          <dt>简介索引</dt>
          <dd>{doc.summary}</dd>
          <dt>版本依据</dt>
          <dd>当前 v{version.number}，保留来源与历史</dd>
        </dl>
      </div>
      <div className="inline-notice">
        <ShieldCheck size={17} />
        <span>
          {allowed
            ? '确认后将共享当前版本；后续个人修改仍需明确更新。'
            : `你可查看${spaceName(state, target)}的资料，入库需要负责人${state.spaces.find((s) => s.id === target)?.owner}批准。申请期间草稿保留在个人空间。`}
        </span>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="modal-actions">
        {onCancel && <Button onClick={onCancel}>取消</Button>}
        <Button
          variant="primary"
          disabled={!target}
          onClick={() => {
            try {
              change((s) => {
                if (canEdit(s, target))
                  publishSnapshot(s, doc.id, doc.title, version, doc.summary, target, visibility, folder);
                else requestShare(s, doc.id, target, visibility, folder);
              });
            } catch (e) {
              setError((e as Error).message);
              return;
            }
            setError('');
            onDone?.();
            ui.toast(
              allowed
                ? `当前版本已共享到${spaceName(state, target)}`
                : '已提交申请，可到智能画报模拟负责人处理',
            );
          }}
        >
          {allowed ? '确认发布当前版本' : '确认申请入库权限'}
        </Button>
      </div>
    </>
  );
}
