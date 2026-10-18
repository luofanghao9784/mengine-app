// Isolated local companion. No .env, seed tenant, external models or production database.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildServer } from '../../integrations/mengine-wiki/dist/api/server.js';
const root = resolve(process.argv[2]);
const config = JSON.parse(readFileSync(join(root, 'scene-private.json'), 'utf8'));
const binding = JSON.parse(readFileSync(join(root, 'scene-binding.json'), 'utf8'));
if (!config.key || config.key.length < 32 || binding.tenant !== config.tenant) throw Error('Invalid local scene configuration');
process.env.MENGINE_PLATFORM_BRIDGE_KEY = config.key;
const { app, store } = await buildServer({ dbPath: join(root, 'scene/mengine.db'), storage: join(root, 'scene/documents'), demo: false, model: {enabled:false,apiKey:'',baseUrl:'http://127.0.0.1:1',model:'disabled'} });
store.db.transaction(() => {
  const existing = store.db.prepare('SELECT source_tenant,user_id FROM platform_tenant_bindings WHERE platform_tenant=?').get(binding.tenant);
  if (existing) {
    const actor = store.db.prepare('SELECT user_id FROM platform_actor_bindings WHERE platform_tenant=? AND actor_id=?').get(binding.tenant,binding.owner);
    if (existing.source_tenant !== binding.tenant || actor?.user_id !== existing.user_id) throw Error('Local owner binding changed; review explicitly before continuing');
    return; // Never overwrite existing roles, grants, documents or users.
  }
  if (store.tenant(binding.tenant)) throw Error('Unbound existing data; refusing automatic takeover');
  store.db.prepare('INSERT INTO tenants VALUES(?,?,?)').run(binding.tenant,binding.name,new Date().toISOString());
  const id = randomUUID();
  store.addUser({id,tenantId:binding.tenant,name:binding.ownerName,email:id+'@local.invalid',department:'企业管理',role:'admin',clearance:3,active:true},randomBytes(48).toString('hex'));
  store.db.prepare('INSERT INTO platform_tenant_bindings VALUES(?,?,?)').run(binding.tenant,binding.tenant,id);
  store.db.prepare('INSERT INTO platform_actor_bindings VALUES(?,?,?)').run(binding.tenant,binding.owner,id);
})();
await app.listen({host:'127.0.0.1',port:Number(process.env.API_PORT)});
console.log('Local scene service ready; model disabled; existing grants preserved.');
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>void app.close().then(()=>process.exit(0)));
