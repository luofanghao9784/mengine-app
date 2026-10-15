import { visibleProposals } from './access-control.js';
import { canGovernResource, canManage, canRead, now, type Doc, type User } from "./domain.js";
import { dictionaryFingerprint } from "./dictionary-version.js";
import type { Store } from "./store.js";

/** A fresh, permission-filtered snapshot. Never persist document text in flow events. */
export function flowSnapshot(store: Store, user: User, filter: {kind?: "all"|"table"|"document";q?:string} = {}) {
  const documents = store.documents(user.tenantId).filter(d => canRead(user, d) || canManage(user, d));
  const structured = new Map<string, {total:number|null;ready:number|null;isolated:number|null;fields:number;dictionary:string;generatedAt?:string;warnings:number;run:string;runAt?:string}>();
  const sets=store.db.prepare('SELECT id,data FROM data_sets WHERE tenant_id=?').all(user.tenantId) as {id:string;data:string}[];
  for(const row of sets){
    const d=documents.find(d=>d.id===row.id);if(!d)continue;
    const definition=JSON.parse(row.data);
    const raw=store.db.prepare('SELECT data FROM data_dictionary WHERE dataset_id=? AND tenant_id=?').get(d.id,user.tenantId) as {data:string}|undefined;
    const dict=raw?JSON.parse(raw.data):null,confirmed=dict?.confirmed;
    const valid=confirmed?.origin==='model'&&confirmed.fingerprint===dictionaryFingerprint(store,user.tenantId,definition);
    const run=store.db.prepare("SELECT event,at FROM document_flow_events WHERE tenant_id=? AND document_id=? AND (event LIKE 'dictionary-%' OR event LIKE 'sync-%') ORDER BY seq DESC LIMIT 1").get(user.tenantId,d.id) as {event:string;at:string}|undefined;
    const count=canRead(user,d)?store.db.prepare("SELECT COUNT(*) total,COALESCE(SUM(status='ready'),0) ready,COALESCE(SUM(status='quarantined'),0) isolated FROM data_rows WHERE tenant_id=? AND dataset_id=?").get(user.tenantId,d.id) as {total:number;ready:number;isolated:number}:null;
    structured.set(d.id,{total:count?.total??null,ready:count?.ready??null,isolated:count?.isolated??null,fields:definition.fields.length,dictionary:valid?'generated':confirmed?'changed':'waiting',generatedAt:valid?confirmed.at:undefined,warnings:valid?confirmed.warnings?.length||0:0,run:run?.event||'',runAt:run?.at});
  }
  const proposals = visibleProposals(store,user);
  const pending = proposals.filter(p => p.status === "pending");
  const readable = documents.filter(d => canRead(user, d));
  const pendingFor = (d: Doc) => pending.filter(p => p.documentId === d.id);
  const priority = (d: Doc) => ['dictionary-generating','dictionary-queued','sync-started'].includes(structured.get(d.id)?.run||'')?0:['dictionary-failed','dictionary-interrupted','sync-failed'].includes(structured.get(d.id)?.run||'')?3:structured.has(d.id)&&structured.get(d.id)?.dictionary!=='generated'&&d.status!=='archived'?4:d.status === "processing" ? 0 : d.status === "queued" ? 1 :
    d.status === "quarantined" ? 2 : d.status === "failed" ? 3 : pendingFor(d).length ? 4 : d.status === "ready" ? 5 : 6;
  // Counts use precisely the same authorization scope as the task list, before the display limit.
  const counts = {
    processing: documents.filter(d => (["queued", "processing"].includes(d.status)||['dictionary-generating','dictionary-queued','sync-started'].includes(structured.get(d.id)?.run||''))&&d.status!=='archived').length,
    quarantined: documents.filter(d => (d.status === "quarantined"||!!structured.get(d.id)?.isolated)&&d.status!=="archived").length,
    failed: documents.filter(d => (d.status === "failed"||["dictionary-failed","dictionary-interrupted","sync-failed"].includes(structured.get(d.id)?.run||""))&&d.status!=="archived").length,
    published: documents.filter(d => d.status === "ready").length,
    pending: pending.length,
  };
  const query=(filter.q||'').trim().toLocaleLowerCase();
  const matching=documents.filter(d=>(!filter.kind||filter.kind==='all'||(structured.has(d.id)?'table':'document')===filter.kind)&&(!query||[d.title,d.department,(store.user(d.ownerId)?.tenantId===user.tenantId?store.user(d.ownerId)?.name:'')||''].some(v=>v.toLocaleLowerCase().includes(query))));
  return {
    matched:matching.length, categories:{all:documents.length,table:structured.size,document:documents.length-structured.size},
    scope: { tenantId: user.tenantId, userId: user.id },
    at: now(), intervalMs: 2000, counts, total: documents.length,
    stats: {
      visible: readable.length, departments: new Set(readable.map(d => d.department)).size,
      quality: readable.length ? Math.round(readable.reduce((sum, d) => sum + d.quality, 0) / readable.length) : 0,
      pending: pending.length,
    },
    items: matching.sort((a, b) => priority(a) - priority(b) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      .slice(0, 40).map(d => {
        const events = store.flowEvents(user.tenantId, d.id);
        const owner = store.user(d.ownerId);
        const reviews = proposals.filter(p => p.documentId === d.id && p.action === "permissions")
          .sort((a, b) => (b.resolvedAt || b.createdAt).localeCompare(a.resolvedAt || a.createdAt));
        const requests = reviews.filter(p => p.status === "pending");
        const latest = reviews[0];
        const stale = (p: typeof latest) => d.version !== p.documentVersion || d.policyVersion !== p.policyVersion;
        const reviewState = requests.length ? (requests.every(stale) ? "stale" : "pending") :
          latest?.status === "applied" && latest.policyVersion + 1 === d.policyVersion ? "applied" :
          latest?.status === "rejected" ? "rejected" : "none";
        return {
          structured: structured.get(d.id),
          id: d.id, title: d.title, kind: d.kind, department: d.department,
          owner: owner?.tenantId === user.tenantId ? owner.name : "责任成员",
          status: d.status, classification: d.classification, audience: d.audience,
          phase: structured.has(d.id)&&d.status!=="archived" ? (['dictionary-generating','dictionary-queued','sync-started'].includes(structured.get(d.id)!.run)?"parsing":["dictionary-failed","dictionary-interrupted","sync-failed"].includes(structured.get(d.id)!.run)?"failed":structured.get(d.id)!.isolated?"quarantined":structured.get(d.id)!.dictionary==="generated"?"ready":"idle") : d.status === "queued" ? "received" : d.status === "processing" ?
            (events[0]?.event === "scanning" ? "scanning" : "parsing") : d.status,
          updatedAt: events[0]?.at || d.updatedAt,
          canRead: canRead(user, d), canManage: canManage(user, d),
          canRemediate: canGovernResource(user, d) && ["ready", "quarantined"].includes(d.status),
          events,
          milestones: store.flowMilestones(user.tenantId, d.id),
          // Same proposal visibility checks as the approval center, without patch/reason data.
          permissionReview: { state: reviewState, count: requests.length,
            ...(requests.length ? { requestedAt: requests[0].createdAt } : latest && reviewState !== "none" ?
              { requestedAt: latest.createdAt, resolvedAt: latest.resolvedAt } : {}) },
          pending: pendingFor(d).map(p => ({
            id: p.id, action: p.action, createdAt: p.createdAt,
            stale: d.version !== p.documentVersion || d.policyVersion !== p.policyVersion,
          })),
        };
      }),
  };
}
