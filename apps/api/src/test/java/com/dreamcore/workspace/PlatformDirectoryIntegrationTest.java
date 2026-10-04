package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.*;
import java.util.UUID;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class PlatformDirectoryIntegrationTest {
    @Autowired PlatformDirectoryService directory;
    @Autowired IdentityService identities;
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    UUID actor,customer,tenant;
    @BeforeEach void setup() {
        actor=UUID.randomUUID();customer=UUID.randomUUID();tenant=UUID.randomUUID();
        for(var id:java.util.List.of(actor,customer)) db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,id+"@directory.test",id.equals(actor)?"平台合成人员":"百分号%合成客户",passwords.encode("synthetic-only-password"));
        db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",actor,actor+"@directory.test",passwords.encode("synthetic-platform-password"));
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",actor);
        db.update("INSERT INTO tenants(id,name) VALUES (?,?)",tenant,"合成企业"+tenant);
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role,status) VALUES (?,?,'TENANT_ADMIN','ACTIVE')",tenant,customer);
    }
    @AfterEach void removePlatformFixture() {
        db.update("DELETE FROM platform_account_changes WHERE actor_id=?",actor);
        db.update("DELETE FROM platform_roles WHERE account_id=?",actor);
        db.update("DELETE FROM platform_accounts WHERE account_id=?",actor);
    }
    @Test void catalogExcludesPlatformPrincipalsAndOnlyReturnsManagementMetadata() {
        var list=directory.customers(actor,customer.toString(),"",0,21);
        assertEquals(1,list.size());assertEquals(customer,list.getFirst().id());
        assertEquals(0,directory.customers(actor,actor.toString(),"",0,21).size());
        assertTrue(directory.customers(actor,"%","ACTIVE",0,100).stream().allMatch(a->a.displayName().contains("%")));
        var detail=directory.detail(actor,customer);assertEquals(1,detail.memberships().size());
        assertEquals(tenant,detail.memberships().getFirst().tenantId());
        assertEquals("TENANT_ADMIN",detail.memberships().getFirst().role());
        assertThrows(IdentityException.class,()->directory.customers(customer,"","",0,21));
        assertEquals(404,assertThrows(IdentityException.class,()->directory.detail(actor,actor)).status);
    }
    @Test void statusIsVersionedIdempotentAndDoesNotRewriteMemberships() {
        UUID request=UUID.randomUUID();
        var disabled=directory.status(actor,customer,request,0,"DISABLED","合成安全处置");
        assertEquals("DISABLED",disabled.account().status());assertEquals(1,disabled.account().version());
        assertEquals("ACTIVE",disabled.memberships().getFirst().membershipStatus());
        assertFalse(identities.validSession(customer,0));
        var retry=directory.status(actor,customer,request,0,"DISABLED","合成安全处置");
        assertEquals(1,retry.account().version());assertEquals(1,retry.records().size());
        assertThrows(IdentityException.class,()->directory.status(actor,customer,request,0,"ACTIVE","合成安全处置"));
        assertThrows(IdentityException.class,()->directory.status(actor,customer,UUID.randomUUID(),0,"ACTIVE","过期提交"));
        var restored=directory.status(actor,customer,UUID.randomUUID(),1,"ACTIVE","核实完成");
        assertEquals(2,restored.account().version());assertEquals(2,restored.records().size());
        assertFalse(identities.validSession(customer,0));assertTrue(identities.validSession(customer,2));
        assertEquals("ACTIVE",restored.memberships().getFirst().membershipStatus());
        assertThrows(IdentityException.class,()->directory.status(actor,actor,UUID.randomUUID(),0,"DISABLED","不能操作平台主体"));
        assertThrows(IdentityException.class,()->directory.status(actor,customer,UUID.randomUUID(),2,"DISABLED"," "));
    }
    @Test void concurrentRetryWritesOneChange() throws Exception {
        UUID request=UUID.randomUUID();
        try(var executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var one=executor.submit(()->directory.status(actor,customer,request,0,"DISABLED","并发合成操作"));
            var two=executor.submit(()->directory.status(actor,customer,request,0,"DISABLED","并发合成操作"));
            assertEquals(1,one.get().account().version());assertEquals(1,two.get().account().version());
            assertEquals(1,directory.detail(actor,customer).records().size());
        }
    }
    @Test void separatelyDisabledMembershipRemainsDisabledWhenAccountIsRestored() {
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,customer);
        directory.status(actor,customer,UUID.randomUUID(),0,"DISABLED","全局安全处置");
        var restored=directory.status(actor,customer,UUID.randomUUID(),1,"ACTIVE","恢复全局登录");
        assertEquals("DISABLED",restored.memberships().getFirst().membershipStatus());
    }
}
