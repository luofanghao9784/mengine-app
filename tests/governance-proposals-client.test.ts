import test from 'node:test';import assert from 'node:assert/strict';import {createProposalsClient,isProposal} from '../src/material/proposals-client.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const proposal={id:id(1),tenantId:id(2),materialId:id(3),sourceName:'合成资料',kind:'TAGS',status:'PENDING',stale:false,patch:{tags:['交付'],summary:null,evidence:[],executionClass:null,modelName:null},reason:'核对业务分类',actorId:id(4),resolvedBy:null,createdAt:'2026-10-12T00:00:00Z',resolvedAt:null};
const response=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('proposal rejects unknown permission actions, stale payloads and foreign scope',async()=>{
 assert.ok(isProposal(proposal));assert.equal(isProposal({...proposal,kind:'PERMISSIONS'}),false);assert.equal(isProposal({...proposal,stale:true}),false);assert.ok(isProposal({...proposal,stale:true,patch:null,reason:null}));
 for(const value of [{...proposal,tenantId:id(9)},{...proposal,id:id(9)}])await assert.rejects(()=>createProposalsClient(async()=>response(value)).detail(id(2),id(1)));
 await assert.rejects(()=>createProposalsClient(async()=>response({items:[proposal],hasMore:false})).list(id(2),'APPLIED'));
});
test('proposal explicit approval uses authenticated request and stable request key',async()=>{
 const calls:unknown[]=[];const client=createProposalsClient(async(url,init)=>{if(String(url).endsWith('/csrf'))return response({token:'synthetic',headerName:'X-CSRF-TOKEN',parameterName:'_csrf'});calls.push(JSON.parse(String(init?.body)));return response({...proposal,status:'APPLIED',resolvedBy:id(4),resolvedAt:'2026-10-12T00:00:00Z'});});
 await client.resolve(id(2),id(1),'APPROVE',id(5));assert.deepEqual(calls,[{decision:'APPROVE',requestId:id(5)}]);
});
