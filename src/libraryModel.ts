import type { DemoState, Material } from './model.ts';

export type MaterialFolder = { id: string; name: string; space: string; parentId?: string };
export const visibleSpaces = (s: DemoState) =>
  s.spaces.filter((space) => space.members.includes(s.profile.name));
export const canReadMaterial = (s: DemoState, doc: Material) => {
  if (doc.space === 'personal') return doc.owner === s.profile.name;
  const space = visibleSpaces(s).find((x) => x.id === doc.space);
  return (
    !!space &&
    (doc.visibility === '空间成员' || (doc.visibility === '仅空间负责人' && space.owner === s.profile.name))
  );
};
export const canManageFolder = (s: DemoState, space: string) =>
  space === 'personal' || visibleSpaces(s).some((x) => x.id === space && x.canEdit);

export function sortMaterials(materials: Material[], sort: 'updated' | 'name') {
  const name = (a: Material, b: Material) =>
    a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id);
  const timestamp = (doc: Material) => {
    const date = doc.versions.at(-1)?.date || '';
    const parsed = Date.parse(date);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...materials].sort((a, b) =>
    sort === 'name' ? name(a, b) : timestamp(b) - timestamp(a) || name(a, b),
  );
}

// A pinned source is usable only while both its material and exact version are readable.
export function readableDraftReferences(s: DemoState, ids: string[], requested: Record<string, string> = {}) {
  const refs = [...new Set(ids)].filter((id) => {
    const doc = s.materials.find((d) => d.id === id && canReadMaterial(s, d));
    return !!doc && (!requested[id] || doc.versions.some((v) => v.id === requested[id]));
  });
  const refVersions = Object.fromEntries(refs.filter((id) => requested[id]).map((id) => [id, requested[id]]));
  return { refs, refVersions };
}

// Directory structure is independent of material identity, versions and sharing.
export function folderTrail(s: DemoState, space: string, id?: string): MaterialFolder[] {
  const trail: MaterialFolder[] = [];
  const seen = new Set<string>();
  while (id) {
    const folder = s.folders?.find((x) => x.id === id && x.space === space);
    if (!folder || seen.has(id)) throw new Error('文件夹已不可用，请重新选择位置。');
    seen.add(id);
    trail.unshift(folder);
    id = folder.parentId;
  }
  return trail;
}
export function locationNames(s: DemoState, space: string, folderId?: string) {
  const root =
    space === 'personal'
      ? ['个人空间']
      : ['企业资料库', s.spaces.find((x) => x.id === space)?.name || '工作空间'];
  return [...root, ...folderTrail(s, space, folderId).map((x) => x.name)];
}
export const folderOptions = (s: DemoState, space: string) =>
  (s.folders || [])
    .filter((x) => x.space === space)
    .map((x) => ({
      id: x.id,
      label: folderTrail(s, space, x.id)
        .map((f) => f.name)
        .join(' / '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
export function validateDestination(s: DemoState, space: string, folderId?: string) {
  if (space !== 'personal' && !visibleSpaces(s).some((x) => x.id === space))
    throw new Error('请选择可访问的目标工作空间。');
  folderTrail(s, space, folderId);
}
export function createFolder(s: DemoState, space: string, name: string, parentId?: string) {
  validateDestination(s, space, parentId);
  if (!canManageFolder(s, space)) throw new Error('你没有此空间的文件夹维护权限。');
  name = name.trim();
  if (!name || name.length > 80 || /[\\/]/.test(name))
    throw new Error('文件夹名称需为 1—80 个字符，且不能包含斜杠。');
  if ((s.folders || []).some((f) => f.space === space && f.parentId === parentId && f.name === name))
    throw new Error('当前位置已有同名文件夹。');
  const folder = { id: crypto.randomUUID(), name, space, parentId };
  (s.folders ||= []).push(folder);
  return folder;
}
export function moveMaterialToFolder(s: DemoState, id: string, folderId?: string) {
  const doc = s.materials.find((x) => x.id === id);
  if (!doc || !canReadMaterial(s, doc) || !canManageFolder(s, doc.space))
    throw new Error('你没有这份资料的整理权限。');
  validateDestination(s, doc.space, folderId);
  doc.folderId = folderId;
}
export function libraryPath(space: string, folderId?: string, docId?: string) {
  return `library/${space}${docId ? `/${docId}` : ''}${folderId ? `?folder=${encodeURIComponent(folderId)}` : ''}`;
}
