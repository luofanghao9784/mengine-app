import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceSatelliteRoll, evolutionFrame } from '../src/operations/engine-stage/evolution-demo.ts';

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

test('satellite roll remains continuous and bounded across four hours of scan transitions', () => {
  const dt = 1 / 60,
    tau = Math.PI * 2;
  let angle = 0.4,
    previousSpeed = 0.32,
    wraps = 0;
  for (let i = 0; i < 4 * 3600 * 60; i++) {
    const frame = evolutionFrame(i * dt, true, false);
    const next = advanceSatelliteRoll(angle, dt, frame);
    const speed = ((next - angle + tau) % tau) / dt;
    assert.ok(speed >= 0.08 - 1e-9 && speed <= 0.32 + 1e-9, 'speed stays 4.6–18.3 degrees per second');
    assert.ok(Math.abs(speed - previousSpeed) <= 0.004, 'no jump at scan or orbit boundaries');
    assert.ok(next >= 0 && next < tau);
    if (next < angle) wraps++;
    angle = next;
    previousSpeed = speed;
  }
  assert.ok(wraps > 100, 'covers repeated angle wrapping');
});
test('real, reduced and zero-time frames preserve satellite orientation; resume has no catch-up jump', () => {
  const angle = 2.1;
  assert.equal(advanceSatelliteRoll(angle, 60, evolutionFrame(12, false, false)), angle);
  assert.equal(advanceSatelliteRoll(angle, 60, evolutionFrame(12, true, true)), angle);
  assert.equal(advanceSatelliteRoll(angle, 0, evolutionFrame(12, true, false)), angle);
  const resumed = advanceSatelliteRoll(angle, 60, evolutionFrame(12, true, false));
  assert.ok(resumed > angle && resumed - angle <= 0.32 / 30);
});
