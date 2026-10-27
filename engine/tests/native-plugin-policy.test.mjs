import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {parseMarketIndex} from '@deepseek-ai/dsh-plugin-market-index';import {apply} from '../dist/native/enterprise-plugin.js';
test('audited manifest uses official market format; disabling modules registers no tools or provider',async()=>{
 const raw=JSON.parse(await readFile(new URL('../native/preinstalled-plugins.json',import.meta.url),'utf8'));
 const market=parseMarketIndex(raw,'https://enterprise.invalid/preinstalled.json');assert.equal(market.plugins.length,2);
 const previous={bridge:process.env.DREAMCORE_NATIVE_BRIDGE,cap:process.env.DREAMCORE_NATIVE_CAPABILITY};
 try{process.env.DREAMCORE_NATIVE_BRIDGE='http://127.0.0.1:1/';process.env.DREAMCORE_NATIVE_CAPABILITY='synthetic';apply({}, {data:false,skills:false});}finally{for(const [key,value] of [['DREAMCORE_NATIVE_BRIDGE',previous.bridge],['DREAMCORE_NATIVE_CAPABILITY',previous.cap]])value===undefined?delete process.env[key]:process.env[key]=value;}
});
