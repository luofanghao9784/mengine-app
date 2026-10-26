package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
/** Explicit local browser acceptance only; runs against with-test-postgres.py. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.knowledge.enabled=true","dreamcore.native.web-url=http://127.0.0.1:18189"})
@EnabledIfEnvironmentVariable(named="NATIVE_BROWSER_ACCEPTANCE",matches="true")
class NativeConversationBrowserIT {
 @Autowired org.springframework.security.crypto.password.PasswordEncoder passwords;@Autowired JdbcTemplate db;@Autowired ConversationService old;@LocalServerPort int port;
 @Test void browserFixture()throws Exception{
  UUID tenant=UUID.randomUUID(),owner=UUID.randomUUID(),space=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'DH 企业链路合成验收')",tenant);
  String password="Native-synthetic-test-12345";
  db.update("INSERT INTO accounts(id,email,display_name,password_hash,username) VALUES (?,?,'合成员工',?,'nativefixture')",owner,owner+"@native.test",passwords.encode(password));
  db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,owner);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成业务空间','SHARED')",space,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,owner);
  var prior=old.submit(owner,tenant,null,space,UUID.randomUUID(),"请记住这段合成旧会话：季度资料整理。","SOURCE_LOOKUP");
  db.update("UPDATE conversation_tasks SET status='SUCCEEDED',reply='合成历史答复：已完成资料整理，等待后续接续。' WHERE conversation_id=?",prior.conversation().id());
  Path directory=Path.of(System.getenv("NATIVE_BROWSER_DIRECTORY"));Files.createDirectories(directory);
  Files.writeString(directory.resolve("ready.json"),new tools.jackson.databind.json.JsonMapper().writeValueAsString(Map.of("port",port,"tenant",tenant,"space",space,"legacy",prior.conversation().id())));
  long deadline=System.currentTimeMillis()+900000;
  while(!Files.exists(directory.resolve("done"))&&System.currentTimeMillis()<deadline)Thread.sleep(500);
  org.junit.jupiter.api.Assertions.assertTrue(Files.exists(directory.resolve("done")),"Browser acceptance did not finish");
  org.junit.jupiter.api.Assertions.assertTrue(db.queryForObject("SELECT count(*) FROM native_conversation_artifacts WHERE session_id IN (SELECT id FROM native_conversations WHERE tenant_id=?)",Integer.class,tenant)>0,"No actual artifact receipt");
  org.junit.jupiter.api.Assertions.assertTrue(db.queryForObject("SELECT count(*) FROM native_conversation_publications WHERE session_id IN (SELECT id FROM native_conversations WHERE tenant_id=?)",Integer.class,tenant)>0,"No actual publication receipt");
 }
}
