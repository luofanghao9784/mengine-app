import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupKnowledgeTopics} from '../src/knowledge-topics.js';
const a={id:'a',origin:'deployment',topicKey:'receipts',title:'收款核对',content:'规则一致',sourceId:'store-a',sourceTitle:'甲店',sourceVersion:2,revision:1,evidence:[{id:'status',quote:'源依据'}]};
const b={...a,id:'b',sourceId:'store-b',sourceTitle:'乙店',sourceVersion:3};
test('one topic preserves each visible source/version; restricted source absent from detail and count',()=>{
 const all=groupKnowledgeTopics([a,b]);assert.equal(all.length,1);assert.deepEqual(all[0].sources.map((s:any)=>s.version),[2,3]);
 const limited=groupKnowledgeTopics([a]);assert.equal(limited[0].id,all[0].id);assert.equal(limited[0].sources.length,1);assert.ok(!JSON.stringify(limited).includes('乙店'));assert.equal(groupKnowledgeTopics([]).length,0);
});
test('changed rules and unspecified topics never merge by similar title',()=>{
 assert.equal(groupKnowledgeTopics([a,{...b,content:'特殊规则'}]).length,2);
 assert.equal(groupKnowledgeTopics([{...a,topicKey:undefined},{...b,topicKey:undefined}]).length,2);
});
