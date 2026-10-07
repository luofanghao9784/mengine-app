import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evolutionFrame } from '../src/operations/engine-stage/evolution-demo.ts';

test('real and reduced modes never animate repair', () => {
  for (const t of [0, 5, 8, 10, 12, 29, 100]) {
    assert.deepEqual(evolutionFrame(t, false, false), evolutionFrame(0, false, false));
    assert.deepEqual(evolutionFrame(t, true, true), evolutionFrame(0, true, true));
    assert.equal(evolutionFrame(t, false, false).strength, 0);
    assert.equal(evolutionFrame(t, true, true).strength, 0);
  }
});
test('demo completes scan, calibration, repair, verification then patrol', () => {
  assert.deepEqual(
    [0, 5, 7, 10, 12, 14, 28].map((t) => evolutionFrame(t, true, false).phase),
    ['巡检中', '扫描中', '校准中', '修复中', '验证中', '巡检中', '巡检中'],
  );
  assert.equal(evolutionFrame(4, true, false).strength, 0);
  assert.equal(evolutionFrame(13, true, false).strength, 0);
  assert.equal(evolutionFrame(11, true, false).repair, 1);
  assert.ok(
    Math.abs(evolutionFrame(28, true, false).angle - evolutionFrame(0, true, false).angle - Math.PI * 2) <
      1e-10,
  );
  for (let t = 0; t < 28; t += 0.1) {
    const a = evolutionFrame(t, true, false),
      b = evolutionFrame(t + 0.1, true, false);
    assert.ok(b.angle > a.angle);
    assert.ok(a.strength >= 0 && a.strength <= 1);
  }
});
