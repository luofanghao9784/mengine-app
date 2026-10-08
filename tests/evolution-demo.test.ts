import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceSatelliteRoll,
  evolutionFrame,
  evolutionScanStarts,
} from '../src/operations/engine-stage/evolution-demo.ts';

test('real and reduced modes never animate repair', () => {
  for (const t of [0, 5, 8, 10, 12, 29, 100]) {
    assert.deepEqual(evolutionFrame(t, false, false), evolutionFrame(0, false, false));
    assert.deepEqual(evolutionFrame(t, true, true), evolutionFrame(0, true, true));
    assert.equal(evolutionFrame(t, false, false).strength, 0);
    assert.equal(evolutionFrame(t, true, true).strength, 0);
  }
});
test('each randomized scan completes all phases with smooth entry and exit', () => {
  for (const start of evolutionScanStarts(0, 0)) {
    assert.deepEqual(
      [0.1, 2.5, 5.5, 7.5, 9].map((offset) => evolutionFrame(start + offset, true, false).phase),
      ['扫描中', '校准中', '修复中', '验证中', '巡检中'],
    );
    assert.equal(evolutionFrame(start, true, false).strength, 0);
    assert.equal(evolutionFrame(start + 9, true, false).strength, 0);
  }
  assert.ok(
    Math.abs(evolutionFrame(28, true, false).angle - evolutionFrame(0, true, false).angle - Math.PI * 2) <
      1e-10,
  );
});
test('every orbit has exactly two nonoverlapping scans with varied positions and safe seams', () => {
  const positions = new Set<string>();
  for (const seed of [0, 42, 4294967295]) {
    for (let orbit = 0; orbit < 1000; orbit++) {
      const [a, b] = evolutionScanStarts(orbit, seed);
      assert.ok(a >= 1 && b >= a + 10 && b + 9 <= 27);
      positions.add(a.toFixed(2) + ':' + b.toFixed(2));
      let starts = 0,
        wasScanning = false;
      for (let step = 0; step < 280; step++) {
        const scanning = evolutionFrame(orbit * 28 + step / 10, true, false, seed).scanTime >= 0;
        if (scanning && !wasScanning) starts++;
        wasScanning = scanning;
      }
      assert.equal(starts, 2);
    }
  }
  assert.ok(positions.size > 2500, 'positions vary rather than repeating at fixed angles');
  assert.notDeepEqual(evolutionScanStarts(0, 0), evolutionScanStarts(0, 42));
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
    assert.ok(
      speed >= 0.32 - 1e-9 && speed <= (Math.PI * 2) / 3 + 1e-9,
      'speed stays 18.3–120 degrees per second',
    );
    assert.ok(Math.abs(speed - previousSpeed) <= 0.04, 'no jump at scan or orbit boundaries');
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
  assert.ok(resumed > angle && resumed - angle <= (Math.PI * 2) / 3 / 30 + 1e-9);
});

test('steady scan rotates at 120 degrees per second across angle wrapping', () => {
  let angle = 0,
    travelled = 0;
  const tau = Math.PI * 2;
  for (let i = 0; i < 5 * 60; i++) {
    const next = advanceSatelliteRoll(
      angle,
      1 / 60,
      evolutionFrame(evolutionScanStarts(0, 0)[0] + 2 + i / 60, true, false),
    );
    travelled += (next - angle + tau) % tau;
    angle = next;
  }
  assert.ok(Math.abs((travelled * 180) / Math.PI - 600) < 1e-8);
});
