package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import static org.junit.jupiter.api.Assertions.*;
class NativeSkillsIntegrationTest extends NativeConversationIntegrationTest {
 @Autowired NativeEnterpriseSkills skills;
 NativeEnterpriseSkills.Put doc(boolean published,List<UUID> audience){return new NativeEnterpriseSkills.Put("---\nname: evidence-review\ndescription: 审阅证据\n---\nRead evidence and cite sources.",published,audience);}
 @Test void onlyAdminPublishesAndEveryLoadRechecksScopeAndPublication(){
  denied(()->skills.put(owner,tenant,"evidence-review",doc(true,List.of())));
  db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=? AND account_id=?",tenant,owner);
  skills.put(owner,tenant,"evidence-review",doc(false,List.of()));assertTrue(skills.list(owner,tenant).isEmpty());
  skills.put(owner,tenant,"evidence-review",doc(true,List.of(owner)));assertEquals(List.of(owner),skills.admin(owner,tenant).getFirst().get("audience"));assertEquals(1,skills.list(owner,tenant).size());assertTrue(skills.list(other,tenant).isEmpty());
  var s=open();var g=nativeSessions.grant(owner,tenant,s.id());assertNotNull(skills.runtime(s.id(),g.token(),"evidence-review"));
  skills.put(owner,tenant,"evidence-review",doc(false,List.of()));denied(()->skills.runtime(s.id(),g.token(),"evidence-review"));
  denied(()->skills.put(owner,tenant,"evidence-review",doc(true,List.of(UUID.randomUUID()))));
  denied(()->skills.put(owner,tenant,"evidence-review",new NativeEnterpriseSkills.Put("---\nname: different\ndescription: x\n---\nx",true,List.of())));
 }
 @Test void realSdkLoadsPlatformSkillAndSlashInvocation()throws Exception{
  db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=? AND account_id=?",tenant,owner);skills.put(owner,tenant,"evidence-review",doc(true,List.of()));
  var s=open();var g=nativeSessions.grant(owner,tenant,s.id());
  java.nio.file.Path root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
  var p=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/native-skills-run.mjs").toString(),"http://127.0.0.1:"+port,s.id().toString(),g.token()).redirectErrorStream(true).start();
  try{assertTrue(p.waitFor(50,java.util.concurrent.TimeUnit.SECONDS));assertEquals(0,p.exitValue(),new String(p.getInputStream().readAllBytes()));}finally{p.destroyForcibly();}
 }
}
