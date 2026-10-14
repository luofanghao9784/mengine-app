import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Store} from './store.js';
import {canManage,scan,now,metadata,type User} from './domain.js';
const fail=(statusCode:number,message:string)=>Object.assign(Error(message),{statusCode});
export function registerLifecycle(app:FastifyInstance,store:Store,session:(r:FastifyRequest)=>User){
 app.patch<{Body:{name:string}}>('/api/workspace',{schema:{body:{type:'object',additionalProperties:false,required:['name'],properties:{name:{type:'string',minLength:1,maxLength:80}}}}},async req=>{const u=session(req);if(u.role!=='admin')throw fail(403,'只有企业管理员可以修改空间名称');const name=req.body.name.trim();if(!name)throw fail(400,'企业名称不能为空');store.db.transaction(()=>{store.db.prepare('UPDATE tenants SET name=? WHERE id=?').run(name,u.tenantId);store.audit(u,'workspace.renamed',name,'更新企业显示名称，企业隔离标识不变');})();return {name};});
 app.delete<{Params:{id:string}}>('/api/members/:id',async req=>{const u=session(req),m=store.user(req.params.id);if(u.role!=='admin')throw fail(403,'只有企业管理员可以移除成员');if(!m||m.tenantId!==u.tenantId)throw fail(404,'成员不存在');if(m.id===u.id)throw fail(409,'不能移除当前登录账号');store.db.transaction(()=>{m.active=false;store.saveUser(m);store.audit(u,'member.disabled',m.name,'移除成员并撤销会话，资料和历史归属保留，可重新启用');})();return {ok:true};});
 app.post<{Params:{id:string}}>('/api/proposals/:id/withdraw',async req=>{const u=session(req),p=store.proposals(u.tenantId).find(p=>p.id===req.params.id);if(!p||p.authorId!==u.id)throw fail(404,'方案不存在或不是本人提交');if(p.status!=='pending')throw fail(409,'已处理方案不可撤回');store.db.transaction(()=>{p.status='withdrawn';p.resolvedAt=now();store.proposal(p);store.audit(u,'proposal.withdrawn',p.id,'提交人撤回方案，可修改后重新提交');})();return {ok:true};});
 app.post<{Params:{id:string}}>('/api/documents/:id/restore',async req=>{
  const u=session(req),d=store.doc(u.tenantId,req.params.id);if(!d||(!canManage(u,d)||(u.role!=='admin'&&u.clearance<d.classification)))throw fail(404,'资料不存在或未授权');if(d.status!=='archived')throw fail(409,'仅归档资料可以恢复');
  store.db.transaction(()=>{store.version(d);const report=scan(d.content,d.tags,d.reviewAt);d.status=d.error||!d.content?'failed':report.sensitive?'quarantined':'ready';d.quality=report.quality;d.issues=report.issues;if(report.sensitive)d.classification=Math.max(2,d.classification);d.version++;d.updatedAt=now();store.saveDoc(d);store.audit(u,'document.restored',d.title,'从归档恢复并重新执行治理校验');})();return metadata(d,u);
 });
 app.patch('/api/departments/:name',async()=>{throw fail(410,'请使用稳定部门 ID 的组织管理接口');});
}
