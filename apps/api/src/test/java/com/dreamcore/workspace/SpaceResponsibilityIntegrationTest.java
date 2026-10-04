package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.governance.GovernanceService;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class SpaceResponsibilityIntegrationTest {
    @Autowired TenantAdminService admin;
    @Autowired IdentityService identities;
    @Autowired GovernanceService governance;
    @Autowired JdbcTemplate db;
    UUID tenant,manager,owner,next,reader,outside;
    @BeforeEach void setup() {
        tenant=UUID.randomUUID();manager=UUID.randomUUID();owner=UUID.randomUUID();next=UUID.randomUUID();reader=UUID.randomUUID();outside=UUID.randomUUID();
        db.update("INSERT INTO tenants(id,name) VALUES (?,?)",tenant,"合成空间职责企业");
        for(var id:List.of(manager,owner,next,reader,outside)) {
            db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'unused-synthetic')",id,id+"@space.test","合成员工"+id);
            if(!id.equals(outside))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role,status) VALUES (?,?,?,'ACTIVE')",tenant,id,id.equals(manager)?"TENANT_ADMIN":"MEMBER");
        }
    }
    TenantAdminService.SharedWorkspace create(UUID responsible) {return admin.createSpace(manager,tenant,UUID.randomUUID(),"合成业务空间",responsible,"稳定业务说明");}
    void code(String expected,Runnable action) {assertEquals(expected,assertThrows(IdentityException.class,action::run).code);}
    boolean canRead(UUID who,UUID space) {return identities.context(who,tenant).workspaces().stream().anyMatch(w->w.id().equals(space));}
    @Test void explicitOwnerGetsScopedResponsibilitiesButCreatorGetsNoContentOrMemberInvitationBySideEffect() {
        var space=create(owner);
        assertEquals(owner,space.ownerId());assertEquals("稳定业务说明",space.description());assertEquals(1,space.memberCount());
        assertFalse(canRead(manager,space.id()));assertTrue(canRead(owner,space.id()));
        assertTrue(admin.grants(owner,tenant,space.id(),0,21).getFirst().canMaintain());
        assertTrue(governance.snapshot(owner,tenant).canEnterManagement());assertFalse(governance.snapshot(owner,tenant).canConfigure());
        assertEquals(1,admin.spaces(owner,tenant,"",0,21).size());
        assertThrows(IdentityException.class,()->admin.members(owner,tenant,"","",0,21));
        assertThrows(IdentityException.class,()->identities.invite(owner,tenant,UUID.randomUUID(),"cannot-invite@space.test"));
        assertThrows(IdentityException.class,()->admin.status(owner,tenant,reader,UUID.randomUUID(),0,"DISABLED"));
        assertThrows(IdentityException.class,()->admin.createSpace(owner,tenant,UUID.randomUUID(),"不可新建",owner,""));
        var other=create(next);
        assertEquals(403,assertThrows(IdentityException.class,()->admin.grants(owner,tenant,other.id(),0,21)).status);
        assertEquals(403,assertThrows(IdentityException.class,()->admin.spaceCandidates(owner,tenant,other.id(),"",0,21)).status);
        assertEquals(1,admin.spaces(owner,tenant,"",0,21).size());
        assertTrue(admin.spaceCandidates(owner,tenant,space.id(),"",0,21).stream().anyMatch(m->m.accountId().equals(reader)));
        var granted=admin.grant(owner,tenant,space.id(),reader,UUID.randomUUID(),0,true);
        assertFalse(admin.grants(owner,tenant,space.id(),0,21).stream().filter(m->m.accountId().equals(reader)).findFirst().orElseThrow().canMaintain());
        var maintained=admin.maintenance(owner,tenant,space.id(),reader,UUID.randomUUID(),granted.version(),true);
        assertTrue(canRead(reader,space.id()));
        code("SPACE_OWNER_CHANGE_REQUIRED",()->admin.grant(manager,tenant,space.id(),owner,UUID.randomUUID(),maintained.version(),false));
        code("SPACE_OWNER_CHANGE_REQUIRED",()->admin.maintenance(owner,tenant,space.id(),owner,UUID.randomUUID(),maintained.version(),false));
        assertEquals(403,assertThrows(IdentityException.class,()->admin.changeOwner(owner,tenant,space.id(),UUID.randomUUID(),maintained.version(),next,"READ")).status);
    }
    @Test void ownerTransferAtomicallyAppliesEachPreviousAccessPolicyAndRevokesManagement() {
        for(String policy:List.of("READ","MAINTAIN","REMOVE")) {
            var space=create(owner);UUID request=UUID.randomUUID();
            var changed=admin.changeOwner(manager,tenant,space.id(),request,0,next,policy);
            assertEquals(next,changed.ownerId());assertEquals(1,changed.version());assertEquals(space.id(),changed.id());
            assertEquals(changed,admin.changeOwner(manager,tenant,space.id(),request,0,next,policy));
            var grants=admin.grants(next,tenant,space.id(),0,21);
            var old=grants.stream().filter(g->g.accountId().equals(owner)).findFirst();
            assertEquals(!policy.equals("REMOVE"),old.isPresent());if(old.isPresent())assertEquals(policy.equals("MAINTAIN"),old.get().canMaintain());
            assertTrue(grants.stream().filter(g->g.accountId().equals(next)).findFirst().orElseThrow().canMaintain());
            assertThrows(IdentityException.class,()->admin.grants(owner,tenant,space.id(),0,21));
            assertEquals(1,db.queryForObject("SELECT count(*) FROM workspace_owner_changes WHERE workspace_id=?",Integer.class,space.id()));
            assertEquals(policy,admin.ownerChanges(next,tenant,space.id()).getFirst().previousAccess());
            assertThrows(IdentityException.class,()->admin.ownerChanges(owner,tenant,space.id()));
            assertTrue(admin.records(manager,tenant,0,100).stream().anyMatch(r->r.action().equals("WORKSPACE_OWNER_CHANGE")&&r.targetId().equals(space.id())));
        }
    }
    @Test void transferFromDisabledOwnerDoesNotReactivateMembership() {
        var space=create(owner);admin.status(manager,tenant,owner,UUID.randomUUID(),0,"DISABLED");
        admin.changeOwner(manager,tenant,space.id(),UUID.randomUUID(),0,next,"MAINTAIN");
        assertEquals("DISABLED",db.queryForObject("SELECT status FROM tenant_memberships WHERE tenant_id=? AND account_id=?",String.class,tenant,owner));
        assertThrows(IdentityException.class,()->identities.context(owner,tenant));
        assertTrue(canRead(next,space.id()));
    }
    @Test void legacyCreatorCannotAcquireScopedManagementAndExplicitAssignmentPreservesOldGrants() {
        UUID space=UUID.randomUUID();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'历史合成空间','SHARED')",space,tenant,owner);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,false)",tenant,space,owner);
        assertNull(admin.spaceInfo(manager,tenant,space).ownerId());assertThrows(IdentityException.class,()->admin.spaceInfo(owner,tenant,space));
        var assigned=admin.changeOwner(manager,tenant,space,UUID.randomUUID(),0,next,"REMOVE");
        assertEquals(next,assigned.ownerId());assertTrue(canRead(owner,space));
        assertEquals("NONE",db.queryForObject("SELECT previous_access FROM workspace_owner_changes WHERE workspace_id=?",String.class,space));
    }
    @Test void selectionRequiresActiveOwnTenantMemberAndCreateRetryDoesNotDuplicateGrants() {
        assertThrows(IdentityException.class,()->create(outside));
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,reader);
        assertThrows(IdentityException.class,()->create(reader));assertThrows(IdentityException.class,()->create(null));
        UUID request=UUID.randomUUID();var space=admin.createSpace(manager,tenant,request,"显式选择自己",manager,"");
        assertEquals(space,admin.createSpace(manager,tenant,request,"显式选择自己",manager,""));assertTrue(canRead(manager,space.id()));
        assertEquals(1,space.memberCount());
        assertThrows(IdentityException.class,()->admin.createSpace(manager,tenant,request,"显式选择自己",owner,""));
    }
    @Test void concurrentScopedGrantsRejectStaleVersionWithoutLockUpgradeDeadlock() throws Exception {
        var space=create(owner);
        try(var executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var results=new ArrayList<java.util.concurrent.Future<Integer>>();
            for(UUID target:List.of(next,reader))results.add(executor.submit(()->{try {admin.grant(owner,tenant,space.id(),target,UUID.randomUUID(),0,true);return 200;}catch(IdentityException e){return e.status;}}));
            assertEquals(List.of(200,409),results.stream().map(f->{try{return f.get(10,java.util.concurrent.TimeUnit.SECONDS);}catch(Exception e){throw new RuntimeException(e);}}).sorted().toList());
        }
    }
    @Test void concurrentTransfersRejectStaleSecondWriter() throws Exception {
        var space=create(owner);
        try(var executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var results=new ArrayList<java.util.concurrent.Future<Integer>>();
            for(UUID target:List.of(next,reader))results.add(executor.submit(()->{try {admin.changeOwner(manager,tenant,space.id(),UUID.randomUUID(),0,target,"READ");return 200;}catch(IdentityException e){return e.status;}}));
            assertEquals(List.of(200,409),results.stream().map(f->{try{return f.get();}catch(Exception e){throw new RuntimeException(e);}}).sorted().toList());
        }
        assertEquals(1,admin.spaceInfo(manager,tenant,space.id()).version());
    }
}
