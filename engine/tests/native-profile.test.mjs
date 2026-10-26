import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('composed official Web profile disables upstream exports while retaining native runtime',()=>{
 const home=mkdtempSync(join(tmpdir(),'dh120-profile-'));
 try{
  const config=execFileSync(process.execPath,[join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'web','--patch',join(root,'profiles/enterprise-web.patch.yml'),'--dump-config'],
   {encoding:'utf8',timeout:30000,env:{PATH:process.env.PATH,HOME:home,DSH_HOME:home},maxBuffer:1024*1024});
  const rows=config.split(/(?=^- id: )/m);
  const row=id=>{const found=rows.find(s=>s.startsWith(`- id: ${id}\n`));assert.ok(found,`upstream row missing: ${id}`);return found;};
  for(const id of ['session-log-deepseek','session-telemetry-otel','plugin-package-inventory-deepseek','desktop-product-telemetry','product-analytics','llm-deepseek-account','deepseek-account','plugin-manager','hmr','account-controller'])
   assert.match(row(id),/^  disabled: true$/m,id);
  for(const id of ['agent','llm','agent-loop','session-persistence-jsonl','web-runtime'])
   assert.doesNotMatch(row(id),/^  disabled: true$/m,id);
 }finally{rmSync(home,{recursive:true,force:true});}
});
