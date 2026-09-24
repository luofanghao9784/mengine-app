import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { isSystemInfo } from '../../contracts/public-api/system.ts';

const read = async (path) =>
  JSON.parse(await readFile(new URL('../../contracts/' + path, import.meta.url), 'utf8'));
const engine = await read('engine-api/capabilities.schema.json');
const system = await read('public-api/system-info.schema.json');
const error = await read('public-api/error.schema.json');
const ajv = new Ajv2020({ allErrors: true });
ajv.addSchema(engine);
const validSystem = ajv.compile(system);

test('engine, public API, frontend type guard and examples agree', async () => {
  const info = await read('fixtures/system-info.json');
  assert.ok(validSystem(info), JSON.stringify(validSystem.errors));
  assert.ok(isSystemInfo(info));
  assert.ok(validSystem({ ...info, dataSource: 'demo' }));
  assert.ok(ajv.getSchema(engine.$id)(await read('fixtures/engine-capabilities.json')));
  assert.ok(ajv.compile(error)(await read('fixtures/engine-unavailable.json')));
  const openapi = await read('public-api/openapi.json');
  const normalized = structuredClone(openapi.components.schemas.SystemInfo);
  normalized.properties.engine.$ref = engine.$id;
  const { $schema, $id, ...withoutIds } = system;
  assert.deepEqual(normalized, withoutIds);
  const {$schema: _schema, $id: _id, ...engineWithoutIds}=engine;
  assert.deepEqual(openapi.components.schemas.EngineCapabilities,engineWithoutIds);
  for(const [mode,harness] of [['agent-verification','verification'],['agent-live','configured']]) {
    const agent={...info,engine:{...info.engine,runtimeMode:mode,capabilities:['source-lookup','agent-task']},integrations:{...info.integrations,harness}};
    assert.ok(validSystem(agent),JSON.stringify(validSystem.errors));assert.ok(isSystemInfo(agent));
    assert.equal(validSystem({...agent,integrations:{...agent.integrations,harness:'not-configured'}}),false);
    assert.equal(isSystemInfo({...agent,integrations:{...agent.integrations,harness:'not-configured'}}),false);
  }
});

test('unsupported version, invented capabilities and incomplete responses fail validation', async () => {
  const info = await read('fixtures/system-info.json');
  for (const invalid of [
    {},
    { ...info, contractVersion: '2.0' },
    { ...info, engine: { ...info.engine, capabilities: ['execute-unrestricted'] } },
    { ...info, integrations: { ...info.integrations, harness: 'ready' } },
  ]) {
    assert.equal(validSystem(invalid), false);
    assert.equal(isSystemInfo(invalid), false);
  }
});
