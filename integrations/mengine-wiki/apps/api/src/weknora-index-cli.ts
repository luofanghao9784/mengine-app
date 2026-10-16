import {Store} from './store.js';
import {configuredRetrieval} from './weknora-retrieval.js';
// Run with a protected environment file. Never pass credentials as CLI arguments.
const [tenant,userId,documentId]=process.argv.slice(2);
if(!tenant||!userId||!documentId||!process.env.DB_PATH) throw new Error('需要 DB_PATH 及企业、执行人、资料编号');
const store=new Store(process.env.DB_PATH);
try {
 const user=store.user(userId);
 if(!user||user.tenantId!==tenant||!user.active) throw new Error('执行身份不匹配');
 const client=configuredRetrieval(store);
 if(!client) throw new Error('知识检索尚未启用');
 const result=await client.index(user,documentId);
 console.log(JSON.stringify({state:result.state}));
} finally {store.close();}
