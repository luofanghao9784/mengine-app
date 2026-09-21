import { useState } from 'react';
import { useDemo, useUI, type DialogSpec } from '../store';
import {
  createFolder,
  folderOptions,
  libraryPath,
  locationNames,
  moveMaterialToFolder,
} from '../libraryModel';
import { Button, Field } from './ui';

export function FolderSelect({
  space,
  value,
  onChange,
  label = '目标文件夹',
}: {
  space: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const { state } = useDemo();
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">根目录</option>
        {folderOptions(state, space).map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function FolderDialog({ spec }: { spec: DialogSpec }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const space = spec.target || 'personal';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          change((s) => createFolder(s, space, name, spec.folderId));
          ui.close();
          ui.toast('文件夹已创建');
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <p className="subtle">位置：{locationNames(state, space, spec.folderId).join(' / ')}</p>
      <Field label="文件夹名称">
        <input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button onClick={ui.close}>取消</Button>
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          创建文件夹
        </Button>
      </div>
    </form>
  );
}
export function MoveMaterialDialog({ id }: { id: string }) {
  const { state, change } = useDemo();
  const ui = useUI();
  const doc = state.materials.find((d) => d.id === id)!;
  const [folder, setFolder] = useState(doc.folderId || '');
  const [error, setError] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          change((s) => moveMaterialToFolder(s, id, folder || undefined));
          ui.go(libraryPath(doc.space, folder || undefined, id));
          ui.toast('资料位置已更新');
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <p className="subtle">
        在{locationNames(state, doc.space).join(' / ')}内整理，资料版本与查看范围保持不变。
      </p>
      <FolderSelect space={doc.space} value={folder} onChange={setFolder} />
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button onClick={ui.close}>取消</Button>
        <Button type="submit" variant="primary" disabled={folder === (doc.folderId || '')}>
          确认移动资料
        </Button>
      </div>
    </form>
  );
}
