import {createHash} from 'node:crypto';
import type {Store} from './store.js';
export function dictionaryFingerprint(store:Store,tenant:string,definition:any){
 const connectionId=definition.provenance?.connectionId;const row=connectionId?store.db.prepare('SELECT data FROM database_connections WHERE id=? AND tenant_id=?').get(connectionId,tenant) as {data:string}|undefined:undefined;
 const sourceFingerprint=row?JSON.parse(row.data).fingerprint:null;
 return createHash('sha256').update(JSON.stringify({definition,sourceFingerprint})).digest('hex');
}

// Deployment semantics survive row changes, never schema/projection changes.
export function dictionarySchemaFingerprint(definition:any){
 const {syncHash,updatePolicy,...schema}=definition;
 return createHash('sha256').update(JSON.stringify(schema)).digest('hex');
}
export function currentDictionary(store:Store,tenant:string,definition:any,confirmed:any):boolean{
 if(!confirmed)return false;
 if(confirmed.origin==='deployment')return confirmed.schemaFingerprint===dictionarySchemaFingerprint(definition);
 return confirmed.origin==='model'&&confirmed.fingerprint===dictionaryFingerprint(store,tenant,definition);
}
