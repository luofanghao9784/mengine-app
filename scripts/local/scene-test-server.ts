/** Disposable synthetic bridge fixture. No .env, production data or model access. */
import { seedDataset, seedRows } from '../../integrations/mengine-wiki/apps/api/test/helpers/structured-fixture.js';
import { buildServer } from '../../integrations/mengine-wiki/apps/api/src/server.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
if (process.env.SCENE_ISOLATED_TEST !== 'true') throw Error('Only enabled by isolated integration tests');
const storage = await mkdtemp(join(tmpdir(), 'scene-bridge-test-'));
const c = await buildServer({
  demo: true,
  storage,
  model: { enabled: false, apiKey: '', baseUrl: 'http://127.0.0.1:1', model: 'disabled' },
});
await c.app.listen({ port: 0, host: '127.0.0.1' });
console.log(JSON.stringify({ port: (c.app.server.address() as { port: number }).port }));
const input = createInterface({ input: process.stdin });
let tableId='';
for await (const line of input) {
  const { tenant, actor, operation } = JSON.parse(line);
  if(operation === 'refresh') {
    seedRows(c.store,tableId,[{amount:'24'}]);
    const doc=c.store.doc(c.store.user('u-admin')!.tenantId,tableId)!;
    c.store.saveDoc({...doc,version:doc.version+1,updatedAt:new Date().toISOString()});
    console.log('refreshed');continue;
  }
  if (operation === 'table') {
    tableId=seedDataset(
      c.store,
      c.store.user('u-admin')!,
      '合成业务表',
      [
        {
          name: 'amount',
          label: '金额',
          type: 'number',
          required: true,
          unique: false,
          sensitive: false,
          description: '人民币元',
        },
      ],
      [{ amount: '12' }],
    );
    console.log('table');
    continue;
  }
  c.store.db
    .prepare('INSERT INTO platform_tenant_bindings VALUES(?,?,?)')
    .run(tenant, 'mengine-demo', 'u-admin');
  c.store.db.prepare('INSERT INTO platform_actor_bindings VALUES(?,?,?)').run(tenant, actor, 'u-admin');
  console.log('bound');
}
await c.app.close();
await rm(storage, { recursive: true, force: true });
