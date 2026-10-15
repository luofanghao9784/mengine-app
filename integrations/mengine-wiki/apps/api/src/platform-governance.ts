import type {Store} from './store.js';
import type {Doc, User} from './domain.js';
import {canUseCurrentData} from './data-availability.js';
import {digest} from './store.js';

// This is a source authorization snapshot, never an instruction to grant target-space access.
export function exportGovernance(store:Store, tenant:string, _serviceActor:string, _serviceUser:User, doc:Doc) {
  const mappings=store.db.prepare('SELECT actor_id,user_id FROM platform_actor_bindings WHERE platform_tenant=? ORDER BY actor_id').all(tenant) as {actor_id:string;user_id:string}[];
  const allowedActors=mappings.filter(m=>{const u=store.user(m.user_id);return !!u&&canUseCurrentData(store,u,doc);}).map(m=>m.actor_id);
  // Service callers (including collection-worker) do not receive end-user rights.
  // Readers come exclusively from verified identity mappings, so every caller sees one revision.
  const policy={sourceId:doc.id,sourceVersion:doc.version,policyVersion:doc.policyVersion,classification:doc.classification,audience:doc.audience,departmentId:doc.departmentId??null,aiPaused:!!doc.aiPaused,allowedActors:[...new Set(allowedActors)].sort()};
  return {...policy,policyDigest:digest(JSON.stringify(policy))};
}

// Compatibility for fixed, server-owned multi-table recipes: access is the intersection.
export function governDerivedAssets(assets:any[]) {
  const byId=new Map(assets.map(a=>[a.id,a]));
  for(const asset of assets.filter(a=>!a.governance)) {
    const sources=(asset.sourceBasis??[]).map((s:any)=>byId.get(s.id));
    const complete=sources.length>0&&sources.every((s:any)=>s?.governance);
    const allowedActors=complete?sources[0].governance.allowedActors.filter((id:string)=>sources.every((s:any)=>s.governance.allowedActors.includes(id))):[];
    const policy={sourceId:asset.id,sourceVersion:asset.version,policyVersion:asset.policyVersion,classification:complete?Math.max(...sources.map((s:any)=>s.governance.classification)):3,audience:'private',aiPaused:!complete,allowedActors:[...new Set(allowedActors)].sort(),sourcePolicyDigests:sources.map((s:any)=>s?.governance?.policyDigest??'missing')};
    asset.governance={...policy,policyDigest:digest(JSON.stringify(policy))};
  }
  return assets;
}
