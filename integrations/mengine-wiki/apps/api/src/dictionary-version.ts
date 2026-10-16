import {createHash} from 'node:crypto';
import type {Store} from './store.js';
export function dictionaryFingerprint(store:Store,tenant:string,definition:any){
 const connectionId=definition.provenance?.connectionId;const row=connectionId?store.db.prepare('SELECT data FROM database_connections WHERE id=? AND tenant_id=?').get(connectionId,tenant) as {data:string}|undefined:undefined;
 const sourceFingerprint=row?JSON.parse(row.data).fingerprint:null;
 return createHash('sha256').update(JSON.stringify({definition,sourceFingerprint})).digest('hex');
}

/** Stable across row sync, invalidated by schema or projection changes. */
export function dictionarySchemaFingerprint(definition:any){
 const {syncHash,updatePolicy,...schema}=definition;
 return createHash('sha256').update(JSON.stringify(schema)).digest('hex');
}
