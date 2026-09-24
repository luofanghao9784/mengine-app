import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/model.ts';
import { createDemoMaterialReadModel } from '../src/data/materialReadModel.ts';

test('Demo reads follow current visibility, including after a permission change', () => {
  const state = seed();
  const reader = createDemoMaterialReadModel(() => state);
  const before = structuredClone(state);
  assert.ok(reader.findVisible('price'));
  assert.ok(reader.listVisible().some((item) => item.id === 'price'));
  assert.deepEqual(state, before);
  state.materials.find((item) => item.id === 'price')!.visibility = '仅空间负责人';
  assert.equal(reader.findVisible('price'), undefined);
  assert.ok(!reader.listVisible().some((item) => item.id === 'price'));
  assert.equal(reader.findVisible('missing'), undefined);
});
