import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/model.ts';
import { readableDraftReferences, sortMaterials } from '../src/libraryModel.ts';

test('历史版本引用必须同时满足当前读取权限和版本身份，失效时不替换为最新版本', () => {
  const s = seed();
  const before = structuredClone(s);
  assert.deepEqual(
    readableDraftReferences(s, ['proposal', 'proposal', 'price'], {
      proposal: 'proposal-v1',
      price: 'missing',
    }),
    {
      refs: ['proposal'],
      refVersions: { proposal: 'proposal-v1' },
    },
  );
  assert.deepEqual(s, before);
  s.materials.find((doc) => doc.id === 'price')!.visibility = '仅空间负责人';
  const priceVersion = s.materials.find((doc) => doc.id === 'price')!.versions[0].id;
  assert.deepEqual(readableDraftReferences(s, ['price'], { price: priceVersion }), {
    refs: [],
    refVersions: {},
  });
});

test('同日资料排序稳定，不依赖输入次序，不改变原资料数组', () => {
  const s = seed();
  const before = structuredClone(s.materials);
  const ordered = sortMaterials(s.materials, 'updated');
  assert.deepEqual(
    ordered.map((doc) => doc.id),
    sortMaterials([...s.materials].reverse(), 'updated').map((doc) => doc.id),
  );
  assert.deepEqual(s.materials, before);
});
