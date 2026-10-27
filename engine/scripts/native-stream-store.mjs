import {KNOWN_SESSION_EVENT_TYPES} from '@deepseek-ai/dsh-session';
import {DatabaseSync} from 'node:sqlite';
/** Host-side durable outbox, outside the agent filesystem. */
export class NativeStreamStore{
 constructor(path,root){this.root=root;this.db=new DatabaseSync(path);this.db.exec(`PRAGMA busy_timeout=5000;PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS native_outbox(root TEXT,key TEXT,event TEXT,delivered INTEGER DEFAULT 0,PRIMARY KEY(root,key));`);}
 append(key,event){const prior=this.db.prepare('SELECT event FROM native_outbox WHERE root=? AND key=?').get(this.root,key);if(prior&&prior.event!==JSON.stringify(event))throw Error('EVENT_RECEIPT_CONFLICT');this.db.prepare('INSERT OR IGNORE INTO native_outbox(root,key,event) VALUES(?,?,?)').run(this.root,key,JSON.stringify(event));if(event.type==='status')this.db.prepare("DELETE FROM native_outbox WHERE root=? AND key<>? AND json_extract(event,'$.type')='status'").run(this.root,key);}
 pending(){return this.db.prepare('SELECT key,event FROM native_outbox WHERE root=? AND delivered=0 ORDER BY rowid LIMIT 100').all(this.root).map(r=>({key:r.key,event:JSON.parse(r.event)}));}
 delivered(key){this.db.prepare('UPDATE native_outbox SET delivered=1 WHERE root=? AND key=?').run(this.root,key);}
 close(){this.db.close();}
}
export function publicNotification(n){
 const p=n.params;
 if(n.method==='session.event'){
  const e=p.event;
  if(!e||!KNOWN_SESSION_EVENT_TYPES.has(e.type)||!Number.isSafeInteger(e.seq))throw Error('invalid event');
  // Internal model request headers and system instructions are never employee data.
  const hidden=['system/message','developer/message','request/header'].includes(e.type);
  return {type:e.type,time:e.time,data:hidden?{redacted:true}:e.data,sessionId:p.sessionId,nativeSeq:e.seq,...(e.surfaceOp?{surfaceOp:e.surfaceOp}:{}),...(e.sourceEventSeqs?{sourceEventSeqs:e.sourceEventSeqs}:{}),...(e.ignorable?{ignorable:true}:{})};
 }
 if(n.method==='session.status')return {type:'session.status',time:new Date().toISOString(),sessionId:p.sessionId,data:{status:p.status}};
 if(['subagent.started','subagent.finished'].includes(n.method))return {type:n.method,time:new Date().toISOString(),data:p};
 if(n.method==='enterprise.interaction'&&['question/asked','question/closed','question/deadline'].includes(p.type))return {type:p.type,time:p.time,sessionId:p.sessionId,data:p.data};
 throw Error('unsupported notification');
}
