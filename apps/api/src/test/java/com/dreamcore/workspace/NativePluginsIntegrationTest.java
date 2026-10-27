package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;import java.util.*;
import org.junit.jupiter.api.Test;import org.springframework.beans.factory.annotation.Autowired;import static org.junit.jupiter.api.Assertions.*;
class NativePluginsIntegrationTest extends NativeConversationIntegrationTest {
 @Autowired NativePluginPolicy plugins;@Autowired NativeEnterpriseSkills skills;
 @Test void onlyAdminCanToggleAuditedModulesAndOldCapabilitiesCannotBypass(){
  denied(()->plugins.toggle(owner,tenant,"enterprise-data",new NativePluginPolicy.Toggle(false,0)));
  db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=? AND account_id=?",tenant,owner);
  var s=open();var g=nativeSessions.grant(owner,tenant,s.id());var artifact=nativeSessions.save(s.id(),g.token(),save(UUID.randomUUID(),"retained artifact"));plugins.toggle(owner,tenant,"enterprise-data",new NativePluginPolicy.Toggle(false,0));
  denied(()->nativeSessions.history(s.id(),g.token()));denied(()->nativeSessions.search(s.id(),g.token(),"test"));denied(()->nativeSessions.save(s.id(),g.token(),save(UUID.randomUUID(),"x")));
  assertArrayEquals("retained artifact".getBytes(),nativeSessions.download(owner,tenant,s.id(),artifact.id()).bytes());
  denied(()->plugins.toggle(owner,tenant,"native-core",new NativePluginPolicy.Toggle(false,1)));denied(()->plugins.toggle(owner,tenant,"remote-plugin",new NativePluginPolicy.Toggle(true,1)));denied(()->plugins.toggle(owner,tenant,"enterprise-data",new NativePluginPolicy.Toggle(true,0)));
  plugins.toggle(owner,tenant,"enterprise-skills",new NativePluginPolicy.Toggle(false,1));denied(()->skills.list(owner,tenant));
  plugins.toggle(owner,tenant,"enterprise-data",new NativePluginPolicy.Toggle(true,2));assertEquals("",nativeSessions.history(s.id(),g.token()));
  denied(()->plugins.list(other,UUID.randomUUID(),false));assertEquals(3L,plugins.snapshot(tenant).get("revision"));
 }
}
