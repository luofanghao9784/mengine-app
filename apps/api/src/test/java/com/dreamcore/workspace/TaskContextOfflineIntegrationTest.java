package com.dreamcore.workspace;

import com.dreamcore.workspace.context.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.NONE,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=off","dreamcore.tasks.initial-delay-ms=3600000"})
class TaskContextOfflineIntegrationTest {
 @Autowired ConversationService conversations;@Autowired TaskContextService contexts;@Autowired JdbcTemplate db;
 @Test void modelOffSavesWaitingTaskWithoutContextReadsOrFictionalExperienceAdoption(){
  UUID tenant=UUID.randomUUID(),owner=UUID.randomUUID(),space=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'not-a-login')",owner,owner+"@example.test","合成离线测试");db.update("INSERT INTO tenants(id,name) VALUES (?,'合成离线企业')",tenant);db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,owner);db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成私人空间','PERSONAL')",space,tenant,owner);
  var t=conversations.submit(owner,tenant,null,space,UUID.randomUUID(),"模型关闭时保存明确任务","AGENT").tasks().getFirst();assertEquals("WAITING_CAPABILITY",t.status());assertEquals(0,t.attempt());assertNull(conversations.claim());assertThrows(IdentityException.class,()->contexts.context(t.id(),UUID.randomUUID(),new TaskContextService.Request("bootstrap",null,null,null,null,null,null,null,null,null,null)));assertEquals(0,db.queryForObject("SELECT count(*) FROM task_context_reads WHERE task_id=?",Integer.class,t.id()));assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_uses WHERE task_id=?",Integer.class,t.id()));
 }
}
