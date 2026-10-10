package com.dreamcore.workspace;

import com.dreamcore.workspace.governance.*;
import com.dreamcore.workspace.identity.*;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.auth.ip-attempts=1000","dreamcore.auth.email-attempts=100"})
class GovernanceProfileIntegrationTest {
    static final String PASSWORD="synthetic-governance-password-2026";
    static final JsonMapper JSON=new JsonMapper();
    static String passwordHash;
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired Environment env;
    @Autowired PasswordEncoder passwords;
    @Autowired GovernanceAccess access;
    @Autowired IdentityService identities;
    UUID platformId,ownerId,memberId,tenant,space,privateSpace;
    Client platform,owner,member;
    final class Client {
        final HttpClient http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
        HttpResponse<String> send(String method,String path,Object body,boolean csrf)throws Exception {
            var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).header("Content-Type","application/json");
            if(csrf){var c=JSON.readTree(send("GET",path.startsWith("/api/platform-admin/")?"/api/platform-admin/v1/auth/csrf":"/api/v1/auth/csrf",null,false).body());request.header(c.get("headerName").asString(),c.get("token").asString());}
            request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)));
            return http.send(request.build(),HttpResponse.BodyHandlers.ofString());
        }
        JsonNode call(String method,String path,Object body,int expected)throws Exception {
            var r=send(method,path,body,!method.equals("GET"));assertEquals(expected,r.statusCode(),r.body());return r.body().isBlank()?null:JSON.readTree(r.body());
        }
    }
    Client client(UUID account)throws Exception{var c=new Client();c.call("POST","/api/v1/auth/login",Map.of("email",account+"@governance.test","password",PASSWORD),200);return c;}
    UUID account(){UUID id=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,id+"@governance.test","合成成员",passwordHash);return id;}
    void addMember(UUID id,String role){db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,id,role);db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人','PERSONAL')",UUID.randomUUID(),tenant,id);}
    String base(){return "/api/v1/tenants/"+tenant;}
    String governance(){return base()+"/governance";}
    Map<String,Object> change(long version){return Map.of("requestId",UUID.randomUUID(),"expectedVersion",version);}
    long revision()throws Exception{return owner.call("GET",governance(),null,200).get("revision").asLong();}
    void acceptOwner()throws Exception{owner.call("POST",governance()+"/accept-initial-responsibility",change(revision()),200);}
    @BeforeEach void fixture()throws Exception {
        if(passwordHash==null)passwordHash=passwords.encode(PASSWORD);
        platformId=account();ownerId=account();memberId=account();db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",platformId);
        db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",platformId,platformId+"@governance.test",passwordHash);
        platform=new Client();platform.call("POST","/api/platform-admin/v1/auth/login",Map.of("username",platformId+"@governance.test","password",PASSWORD),200);owner=client(ownerId);member=client(memberId);
        // A pre-migration enterprise fixture exercises explicit legacy responsibility and recovery.
        var created=JSON.readTree(JSON.writeValueAsString(identities.createTenant(platformId,UUID.randomUUID(),"隔离治理企业",ownerId+"@governance.test",true)));
        tenant=UUID.fromString(created.get("tenant").get("id").asString());
        String invitation=created.get("invitation").get("id").asString();
        String token=JSON.readTree(Files.readString(Path.of(env.getRequiredProperty("dreamcore.invitation.outbox"),invitation+".json"))).get("token").asString();
        owner.call("POST","/api/v1/auth/invitations/accept",Map.of("token",token),200);addMember(memberId,"MEMBER");
        space=UUID.randomUUID();privateSpace=UUID.randomUUID();
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享','SHARED')",space,tenant,ownerId);
        privateSpace=db.queryForObject("SELECT id FROM workspaces WHERE tenant_id=? AND owner_id=? AND kind='PERSONAL'",UUID.class,tenant,memberId);
    }
    @AfterEach void cleanup(){
        if(platformId!=null){db.update("DELETE FROM platform_roles WHERE account_id=?",platformId);db.update("DELETE FROM platform_sessions WHERE account_id=?",platformId);db.update("DELETE FROM platform_accounts WHERE account_id=?",platformId);}
        // This HTTP fixture only uses loopback; do not leak its login volume into later suites.
        db.update("DELETE FROM login_attempts WHERE bucket=?",IdentityService.hash("ip:127.0.0.1"));
    }
    @Test void explicitNominationAndAcceptanceNeverBackfillLegacyOwners()throws Exception {
        var initial=owner.call("GET",governance(),null,200);assertTrue(initial.get("ownerId").isNull());assertTrue(initial.get("canAcceptInitialResponsibility").asBoolean());
        member.call("POST",governance()+"/accept-initial-responsibility",change(0),403);
        platform.call("GET",governance(),null,403);
        var request=change(0);var accepted=owner.call("POST",governance()+"/accept-initial-responsibility",request,200);assertEquals(ownerId.toString(),accepted.get("ownerId").asString());
        assertEquals(accepted,owner.call("POST",governance()+"/accept-initial-responsibility",request,200));
        UUID legacy=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'存量企业')",legacy);db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",legacy,ownerId);
        String path="/api/v1/tenants/"+legacy+"/governance";
        assertFalse(owner.call("GET",path,null,200).get("canAcceptInitialResponsibility").asBoolean());owner.call("POST",path+"/accept-initial-responsibility",change(0),403);
        var recovery=owner.call("POST",path+"/recovery-requests",Map.of("requestId",UUID.randomUUID(),"reason","LEGACY_OWNER_UNVERIFIED"),200);
        assertEquals("PENDING_VERIFICATION",recovery.get("status").asString());assertTrue(owner.call("GET",path,null,200).get("ownerId").isNull());
    }
    @Test void singleOwnerCanExplicitlyGrantSelfButAdminsCannotReciprocate()throws Exception {
        acceptOwner();String manage="/api/tenant-admin/v1/tenants/"+tenant;
        owner.call("POST",manage+"/workspaces/"+space+"/members/"+ownerId,Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"enabled",true),200);
        owner.call("POST",manage+"/workspaces/"+space+"/members/"+ownerId+"/maintenance",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"enabled",true),200);
        owner.call("POST",governance()+"/members/"+memberId+"/role",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"role","TENANT_ADMIN"),200);
        member.call("POST",governance()+"/members/"+ownerId+"/role",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"role","MEMBER"),403);
        member.call("POST",manage+"/workspaces/"+space+"/members/"+memberId,Map.of("requestId",UUID.randomUUID(),"expectedVersion",2,"enabled",true),403);
        UUID another=account();addMember(another,"TENANT_ADMIN");
        member.call("POST",manage+"/workspaces/"+space+"/members/"+another,Map.of("requestId",UUID.randomUUID(),"expectedVersion",2,"enabled",true),403);
        member.call("POST",manage+"/members/"+ownerId+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","DISABLED"),409);
        owner.call("GET",base()+"/profiles/PERSONAL/"+memberId,null,404);
    }
    @Test void emergencySelfStopCanFreezeSoleOwnerWithoutTransferringResponsibility()throws Exception {
        acceptOwner();String manage="/api/tenant-admin/v1/tenants/"+tenant;
        String stop=manage+"/members/"+ownerId+"/emergency-disable";
        var body=Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"securityAction","SECURITY_RISK");
        owner.call("POST",manage+"/members/"+ownerId+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","DISABLED"),409);
        member.call("POST",stop,body,403);platform.call("POST",stop,body,403);
        assertEquals(403,owner.send("POST",stop,body,false).statusCode());
        owner.call("POST",stop,Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"securityAction","ORDINARY"),400);
        var offer=owner.call("POST",governance()+"/handover",Map.of("requestId",UUID.randomUUID(),"expectedVersion",revision(),"accountId",memberId),200);
        UUID otherTenant=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'另一个企业')",otherTenant);
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",otherTenant,ownerId);
        var result=owner.call("POST",stop,body,200);
        assertEquals("DISABLED",result.get("status").asString());assertEquals(1,result.get("version").asLong());
        assertEquals("PENDING_VERIFICATION",result.get("recoveryStatus").asString());
        owner.call("GET",governance(),null,403);owner.call("POST",stop,body,403);
        member.call("POST",governance()+"/handover/"+offer.get("pendingHandover").get("id").asString()+"/accept",change(offer.get("revision").asLong()),409);
        assertEquals(ownerId,db.queryForObject("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE tenant_id=? AND role='TENANT_ADMIN' AND status='ACTIVE'",Integer.class,tenant));
        assertEquals("ACTIVE",db.queryForObject("SELECT status FROM accounts WHERE id=?",String.class,ownerId));
        assertEquals("ACTIVE",db.queryForObject("SELECT status FROM tenant_memberships WHERE tenant_id=? AND account_id=?",String.class,otherTenant,ownerId));
        String recoveryPath="/api/platform-admin/v1/tenants/"+tenant+"/governance-recovery-requests/"+result.get("recoveryRequestId").asString();
        assertEquals("OWNER_UNAVAILABLE",platform.call("GET",recoveryPath,null,200).get("reason").asString());
        platform.call("GET",base()+"/profiles/PERSONAL/"+ownerId,null,403);
    }
    @Test void emergencyStopIsIdempotentDistinctFromOrdinaryStatusAndCannotBypassRecovery()throws Exception {
        acceptOwner();owner.call("POST",governance()+"/members/"+memberId+"/role",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"role","TENANT_ADMIN"),200);
        String manage="/api/tenant-admin/v1/tenants/"+tenant, stop=manage+"/members/"+ownerId+"/emergency-disable";
        UUID key=UUID.randomUUID();var body=Map.of("requestId",key,"expectedVersion",0,"securityAction","SECURITY_RISK");
        member.call("GET","/api/v1/auth/csrf",null,200); // Establish the post-login token before issuing concurrent writes.
        JsonNode first,second;
        try(var pool=Executors.newFixedThreadPool(2)) {
            var a=pool.submit(()->member.send("POST",stop,body,true));var b=pool.submit(()->member.send("POST",stop,body,true));
            var r1=a.get();var r2=b.get();assertEquals(200,r1.statusCode(),r1.body());assertEquals(200,r2.statusCode(),r2.body());
            first=JSON.readTree(r1.body());second=JSON.readTree(r2.body());
        }
        assertEquals(first,second);assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_security_stops WHERE tenant_id=?",Integer.class,tenant));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_recovery_requests WHERE tenant_id=?",Integer.class,tenant));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action='MEMBER_SECURITY_DISABLE'",Integer.class,tenant));
        member.call("POST",manage+"/members/"+ownerId+"/status",Map.of("requestId",key,"expectedVersion",0,"status","DISABLED"),409);
        var restore=member.call("POST",manage+"/members/"+ownerId+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"status","ACTIVE"),409);
        assertEquals("SECURITY_RECOVERY_PENDING",restore.get("code").asString());
        member.call("POST",stop,Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"securityAction","SECURITY_RISK"),409);
        member.call("POST",governance()+"/members/"+memberId+"/role",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"role","MEMBER"),403);
        assertEquals(ownerId,db.queryForObject("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant));
        assertTrue(member.call("GET",manage+"/records",null,200).toString().contains("MEMBER_SECURITY_DISABLE"));
        assertEquals("PENDING_VERIFICATION",member.call("GET",governance()+"/recovery-requests/"+first.get("recoveryRequestId").asString(),null,200).get("status").asString());
    }
    @Test void legacyLastAdminMayUseSafetyStopWithoutImplicitlyBecomingOwner()throws Exception {
        String manage="/api/tenant-admin/v1/tenants/"+tenant;
        var ordinary=owner.call("POST",manage+"/members/"+ownerId+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","DISABLED"),409);
        assertEquals("LAST_TENANT_ADMIN",ordinary.get("code").asString());
        var result=owner.call("POST",manage+"/members/"+ownerId+"/emergency-disable",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"securityAction","SECURITY_RISK"),200);
        assertEquals("LEGACY_OWNER_UNVERIFIED",db.queryForObject("SELECT reason FROM governance_recovery_requests WHERE id=?",String.class,UUID.fromString(result.get("recoveryRequestId").asString())));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM tenant_governance WHERE tenant_id=? AND owner_id IS NOT NULL",Integer.class,tenant));
        member.call("POST",governance()+"/accept-initial-responsibility",change(0),403);
    }
    @Test void safetyReceiptReplayDoesNotRepeatAStopAfterExplicitOrdinaryMemberRestoration()throws Exception {
        acceptOwner();String manage="/api/tenant-admin/v1/tenants/"+tenant+"/members/"+memberId;
        var body=Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"securityAction","SECURITY_RISK");
        var receipt=owner.call("POST",manage+"/emergency-disable",body,200);
        assertTrue(receipt.get("recoveryRequestId").isNull());
        owner.call("POST",manage+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"status","ACTIVE"),200);
        assertEquals(receipt,owner.call("POST",manage+"/emergency-disable",body,200));
        assertEquals("ACTIVE",db.queryForObject("SELECT status FROM tenant_memberships WHERE tenant_id=? AND account_id=?",String.class,tenant,memberId));
        assertEquals(2,db.queryForObject("SELECT management_version FROM tenant_memberships WHERE tenant_id=? AND account_id=?",Long.class,tenant,memberId));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action='MEMBER_SECURITY_DISABLE'",Integer.class,tenant));
    }
    @Test void concurrentSafetyStopsRecheckActorAuthorityAfterTenantLock()throws Exception {
        acceptOwner();owner.call("POST",governance()+"/members/"+memberId+"/role",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"role","TENANT_ADMIN"),200);
        String manage="/api/tenant-admin/v1/tenants/"+tenant+"/members/";
        try(var pool=Executors.newFixedThreadPool(2)) {
            var a=pool.submit(()->owner.send("POST",manage+memberId+"/emergency-disable",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"securityAction","SECURITY_RISK"),true));
            var b=pool.submit(()->member.send("POST",manage+ownerId+"/emergency-disable",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"securityAction","SECURITY_RISK"),true));
            assertEquals(List.of(200,403),java.util.stream.Stream.of(a.get().statusCode(),b.get().statusCode()).sorted().toList());
        }
        assertEquals(1,db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE tenant_id=? AND role='TENANT_ADMIN' AND status='ACTIVE'",Integer.class,tenant));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_security_stops WHERE tenant_id=?",Integer.class,tenant));
        assertEquals(ownerId,db.queryForObject("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant));
    }
    @Test void scopedMaintenanceAndExtraActionsAreExplicitAndRevocationDoesNotResurrect()throws Exception {
        acceptOwner();db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,memberId);
        var cap=Map.of("requestId",UUID.randomUUID(),"expectedVersion",revision(),"accountId",memberId,"workspaceId",space,"capability","PROFILE_MAINTAIN","enabled",true);
        owner.call("POST",governance()+"/capabilities",cap,200);
        var state=member.call("GET",governance(),null,200);assertTrue(state.get("canEnterManagement").asBoolean());assertFalse(state.get("canConfigure").asBoolean());
        member.call("GET","/api/tenant-admin/v1/tenants/"+tenant+"/members",null,403);
        member.call("POST",base()+"/profiles/WORKSPACE/"+space,profile("口径","FACT","月度","ACTIVE"),200);
        assertFalse(access.allows(ownerId,tenant,GovernanceAccess.Capability.METHOD_ADOPT,null));assertFalse(access.allows(ownerId,tenant,GovernanceAccess.Capability.TENANT_EXIT,null));
        var tenantGrant=new HashMap<String,Object>();tenantGrant.put("requestId",UUID.randomUUID());tenantGrant.put("expectedVersion",revision());tenantGrant.put("accountId",memberId);tenantGrant.put("workspaceId",null);tenantGrant.put("capability","PLAN_CONFIGURE");tenantGrant.put("enabled",true);
        owner.call("POST",governance()+"/capabilities",tenantGrant,200);assertTrue(access.allows(memberId,tenant,GovernanceAccess.Capability.PLAN_CONFIGURE,null));
        db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,memberId);
        member.call("GET",base()+"/profiles/WORKSPACE/"+space,null,404);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,memberId);
        assertFalse(access.allows(memberId,tenant,GovernanceAccess.Capability.PROFILE_MAINTAIN,space));
        owner.call("POST",governance()+"/capabilities",cap,200);assertFalse(access.allows(memberId,tenant,GovernanceAccess.Capability.PROFILE_MAINTAIN,space));
    }
    @Test void handoverRequiresAcceptanceAndConcurrentOffersHaveOneWinner()throws Exception {
        acceptOwner();UUID other=account();addMember(other,"MEMBER");long revision=revision();
        var offer1=Map.of("requestId",UUID.randomUUID(),"expectedVersion",revision,"accountId",memberId);
        var offer2=Map.of("requestId",UUID.randomUUID(),"expectedVersion",revision,"accountId",other);
        HttpResponse<String> r1,r2;
        try(var pool=Executors.newFixedThreadPool(2)){var a=pool.submit(()->owner.send("POST",governance()+"/handover",offer1,true));var b=pool.submit(()->owner.send("POST",governance()+"/handover",offer2,true));r1=a.get();r2=b.get();}
        assertEquals(List.of(200,409),java.util.stream.Stream.of(r1.statusCode(),r2.statusCode()).sorted().toList());
        var offered=JSON.readTree((r1.statusCode()==200?r1:r2).body());UUID next=UUID.fromString(offered.get("pendingHandover").get("toAccount").asString());String id=offered.get("pendingHandover").get("id").asString();
        assertEquals(ownerId.toString(),offered.get("ownerId").asString());owner.call("POST",governance()+"/handover/"+id+"/accept",change(offered.get("revision").asLong()),404);
        Client receiver=next.equals(memberId)?member:client(other);assertTrue(receiver.call("GET",governance(),null,200).get("canEnterManagement").asBoolean());var accepted=receiver.call("POST",governance()+"/handover/"+id+"/accept",change(offered.get("revision").asLong()),200);
        assertEquals(next.toString(),accepted.get("ownerId").asString());assertEquals("TENANT_ADMIN",db.queryForObject("SELECT role FROM tenant_memberships WHERE tenant_id=? AND account_id=?",String.class,tenant,next));
        owner.call("POST",governance()+"/members/"+memberId+"/role",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"role","MEMBER"),403);
        assertEquals(memberId,db.queryForObject("SELECT owner_id FROM workspaces WHERE id=?",UUID.class,privateSpace));
    }
    @Test void handoverRoleChoiceIsAtomicAndDoesNotChangeContentOrSpaceResponsibility()throws Exception {
        acceptOwner();
        db.update("UPDATE workspaces SET responsibility_confirmed=true WHERE id=?",space);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,ownerId);
        var offer=owner.call("POST",governance()+"/handover",Map.of("requestId",UUID.randomUUID(),"expectedVersion",revision(),"accountId",memberId,"previousOwnerRole","MEMBER"),200);
        assertEquals("MEMBER",offer.get("pendingHandover").get("previousOwnerRole").asString());
        assertEquals("TENANT_ADMIN",db.queryForObject("SELECT role FROM tenant_memberships WHERE tenant_id=? AND account_id=?",String.class,tenant,ownerId));
        String id=offer.get("pendingHandover").get("id").asString();var body=change(offer.get("revision").asLong());
        var accepted=member.call("POST",governance()+"/handover/"+id+"/accept",body,200);
        assertEquals(accepted,member.call("POST",governance()+"/handover/"+id+"/accept",body,200));
        assertEquals("MEMBER",db.queryForObject("SELECT role FROM tenant_memberships WHERE tenant_id=? AND account_id=?",String.class,tenant,ownerId));
        assertEquals("TENANT_ADMIN",db.queryForObject("SELECT role FROM tenant_memberships WHERE tenant_id=? AND account_id=?",String.class,tenant,memberId));
        assertEquals(ownerId,db.queryForObject("SELECT owner_id FROM workspaces WHERE id=?",UUID.class,space));
        assertTrue(db.queryForObject("SELECT can_maintain FROM workspace_members WHERE workspace_id=? AND account_id=?",Boolean.class,space,ownerId));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM workspace_members WHERE workspace_id=? AND account_id=?",Integer.class,space,memberId));
        assertEquals(memberId,db.queryForObject("SELECT owner_id FROM workspaces WHERE id=?",UUID.class,privateSpace));
        assertEquals("ACCEPTED",owner.call("GET",governance(),null,200).get("latestHandover").get("status").asString());
        String records=member.call("GET","/api/tenant-admin/v1/tenants/"+tenant+"/records",null,200).toString();
        assertTrue(records.contains("OWNER_HANDOVER_ACCEPT"));assertTrue(records.contains("OWNER_HANDOVER_OFFER"));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action='OWNER_HANDOVER_ACCEPT'",Integer.class,tenant));
    }
    @Test void rejectAndCancelAreScopedIdempotentAndNeverSilentlyReplacePending()throws Exception {
        acceptOwner();UUID outsider=account();addMember(outsider,"TENANT_ADMIN");var admin=client(outsider);
        var offerBody=Map.of("requestId",UUID.randomUUID(),"expectedVersion",revision(),"accountId",memberId);
        var offer=owner.call("POST",governance()+"/handover",offerBody,200);
        assertEquals(offer,owner.call("POST",governance()+"/handover",offerBody,200));
        assertEquals("TENANT_ADMIN",offer.get("pendingHandover").get("previousOwnerRole").asString());
        var pending=offer.get("pendingHandover");String path=governance()+"/handover/"+pending.get("id").asString();long rev=offer.get("revision").asLong();
        var blocked=owner.call("POST",governance()+"/handover",Map.of("requestId",UUID.randomUUID(),"expectedVersion",rev,"accountId",outsider),409);
        assertTrue(blocked.toString().contains("HANDOVER_ALREADY_PENDING"));
        assertTrue(admin.call("GET",governance(),null,200).get("pendingHandover").isNull());
        admin.call("POST",path+"/reject",change(rev),404);admin.call("POST",path+"/cancel",change(rev),404);
        owner.call("POST",path+"/reject",change(rev),404);member.call("POST",path+"/cancel",change(rev),404);
        assertEquals(403,member.send("POST",path+"/reject",change(rev),false).statusCode());
        member.call("POST",path+"/reject",change(rev-1),409);
        var reject=change(rev);var rejected=member.call("POST",path+"/reject",reject,200);
        assertEquals(rejected,member.call("POST",path+"/reject",reject,200));
        assertEquals("REJECTED",owner.call("GET",governance(),null,200).get("latestHandover").get("status").asString());
        assertTrue(admin.call("GET",governance(),null,200).get("latestHandover").isNull());
        member.call("POST",path+"/accept",change(rejected.get("revision").asLong()),409);
        offer=owner.call("POST",governance()+"/handover",Map.of("requestId",UUID.randomUUID(),"expectedVersion",revision(),"accountId",memberId),200);
        path=governance()+"/handover/"+offer.get("pendingHandover").get("id").asString();var cancel=change(offer.get("revision").asLong());
        var cancelled=owner.call("POST",path+"/cancel",cancel,200);assertEquals(cancelled,owner.call("POST",path+"/cancel",cancel,200));
        assertEquals("CANCELLED",cancelled.get("latestHandover").get("status").asString());
        assertEquals(ownerId.toString(),cancelled.get("ownerId").asString());
        assertEquals("MEMBER",db.queryForObject("SELECT role FROM tenant_memberships WHERE tenant_id=? AND account_id=?",String.class,tenant,memberId));
    }
    @Test void acceptAndCancelRaceHasOneWinnerAndConsistentRoles()throws Exception {
        acceptOwner();var offer=owner.call("POST",governance()+"/handover",Map.of("requestId",UUID.randomUUID(),"expectedVersion",revision(),"accountId",memberId,"previousOwnerRole","MEMBER"),200);
        String path=governance()+"/handover/"+offer.get("pendingHandover").get("id").asString();long rev=offer.get("revision").asLong();
        HttpResponse<String> accept,cancel;
        try(var pool=Executors.newFixedThreadPool(2)){var a=pool.submit(()->member.send("POST",path+"/accept",change(rev),true));var b=pool.submit(()->owner.send("POST",path+"/cancel",change(rev),true));accept=a.get(10,TimeUnit.SECONDS);cancel=b.get(10,TimeUnit.SECONDS);}
        assertEquals(List.of(200,409),java.util.stream.Stream.of(accept.statusCode(),cancel.statusCode()).sorted().toList());
        boolean accepted=accept.statusCode()==200;
        assertEquals(accepted?memberId:ownerId,db.queryForObject("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant));
        assertEquals(accepted?"MEMBER":"TENANT_ADMIN",db.queryForObject("SELECT role FROM tenant_memberships WHERE tenant_id=? AND account_id=?",String.class,tenant,ownerId));
        assertEquals(accepted?"TENANT_ADMIN":"MEMBER",db.queryForObject("SELECT role FROM tenant_memberships WHERE tenant_id=? AND account_id=?",String.class,tenant,memberId));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action IN ('OWNER_HANDOVER_ACCEPT','OWNER_HANDOVER_CANCEL')",Integer.class,tenant));
    }
    @Test void handoverRejectsForeignMembersInactiveSuccessorsAndInvalidPreviousRole()throws Exception {
        acceptOwner();UUID other=account();
        owner.call("POST",governance()+"/handover",Map.of("requestId",UUID.randomUUID(),"expectedVersion",revision(),"accountId",other),409);
        owner.call("POST",governance()+"/handover",Map.of("requestId",UUID.randomUUID(),"expectedVersion",revision(),"accountId",memberId,"previousOwnerRole","PLATFORM_ADMIN"),400);
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,memberId);
        owner.call("POST",governance()+"/handover",Map.of("requestId",UUID.randomUUID(),"expectedVersion",revision(),"accountId",memberId),409);
        assertEquals(0,db.queryForObject("SELECT count(*) FROM governance_handovers WHERE tenant_id=?",Integer.class,tenant));
    }
    @Test void administratorPromotionAndDemotionAreOwnerOnlyAndPreserveSpaceRights()throws Exception {
        acceptOwner();db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,memberId);
        db.update("UPDATE workspaces SET owner_id=?,responsibility_confirmed=true WHERE id=?",memberId,space);
        var promote=Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"role","TENANT_ADMIN");String path=governance()+"/members/"+memberId+"/role";
        owner.call("POST",path,promote,200);owner.call("POST",path,promote,200);
        member.call("POST",governance()+"/members/"+ownerId+"/role",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"role","MEMBER"),403);
        var demote=Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"role","MEMBER");owner.call("POST",path,demote,200);
        owner.call("POST",path,Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"role","TENANT_ADMIN"),409);
        assertEquals(memberId,db.queryForObject("SELECT owner_id FROM workspaces WHERE id=?",UUID.class,space));
        assertTrue(db.queryForObject("SELECT can_maintain FROM workspace_members WHERE workspace_id=? AND account_id=?",Boolean.class,space,memberId));
        assertTrue(member.call("GET",governance(),null,200).get("canEnterManagement").asBoolean());
        assertTrue(owner.call("GET","/api/tenant-admin/v1/tenants/"+tenant+"/records",null,200).toString().contains("GOVERNANCE_ROLE"));
    }
    Map<String,Object> profile(String key,String kind,String value,String status){return Map.of("requestId",UUID.randomUUID(),"key",key,"kind",kind,"value",value,"status",status,"provenance","合成用户明确记录");}
    @Test void profilesSeparateKindsScopesVersionsAndDoNotGrantAuthorities()throws Exception {
        acceptOwner();var fact=owner.call("POST",base()+"/profiles/TENANT/"+tenant,profile("行业","FACT","服务业","ACTIVE"),200);
        member.call("POST",base()+"/profiles/TENANT/"+tenant,profile("行业2","FACT","越权写入","ACTIVE"),403);
        var inferred=member.call("POST",base()+"/profiles/PERSONAL/"+memberId,profile("岗位","INFERENCE","企业授权负责人","PROPOSED"),200);
        assertEquals("PROPOSED",inferred.get("effectiveStatus").asString());assertFalse(member.call("GET",governance(),null,200).get("owner").asBoolean());
        var goal=member.call("POST",base()+"/profiles/PERSONAL/"+memberId,profile("目标","GOAL","每周生成报告","ACTIVE"),200);assertEquals("GOAL",goal.get("kind").asString());
        var pref=member.call("POST",base()+"/profiles/PERSONAL/"+memberId,profile("表达","PREFERENCE","简洁","ACTIVE"),200);String id=pref.get("id").asString();
        var update=Map.of("requestId",UUID.randomUUID(),"expectedRevision",1,"value","详细","provenance","本人更正","status","ACTIVE");
        member.call("POST",base()+"/profiles/entries/"+id+"/versions",update,200);
        member.call("POST",base()+"/profiles/entries/"+id+"/withdraw",Map.of("requestId",UUID.randomUUID(),"expectedRevision",2),200);
        assertEquals(2,member.call("POST",base()+"/profiles/entries/"+id+"/versions",update,200).get("revision").asInt());
        assertEquals("WITHDRAWN",member.call("GET",base()+"/profiles/entries/"+id,null,200).get("status").asString());
        assertEquals("简洁",member.call("GET",base()+"/profiles/entries/"+id+"?version=1",null,200).get("value").asString());
        owner.call("GET",base()+"/profiles/entries/"+id,null,404);platform.call("GET",base()+"/profiles/entries/"+fact.get("id").asString(),null,403);
        assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant));
    }
    @Test void expiredPreferenceIsNotEffectiveAndConcurrentEditsNeverOverwrite()throws Exception {
        var body=new HashMap<>(profile("时效","PREFERENCE","一次任务","ACTIVE"));body.put("expiresAt","2020-01-01T00:00:00Z");
        var expired=member.call("POST",base()+"/profiles/PERSONAL/"+memberId,body,200);assertEquals("EXPIRED",expired.get("effectiveStatus").asString());String id=expired.get("id").asString();
        var one=Map.of("requestId",UUID.randomUUID(),"expectedRevision",1,"value","甲","provenance","更正甲","status","ACTIVE");
        var two=Map.of("requestId",UUID.randomUUID(),"expectedRevision",1,"value","乙","provenance","更正乙","status","ACTIVE");
        try(var pool=Executors.newFixedThreadPool(2)){var a=pool.submit(()->member.send("POST",base()+"/profiles/entries/"+id+"/versions",one,true));var b=pool.submit(()->member.send("POST",base()+"/profiles/entries/"+id+"/versions",two,true));assertEquals(List.of(200,409),java.util.stream.Stream.of(a.get().statusCode(),b.get().statusCode()).sorted().toList());}
        assertEquals(2,db.queryForObject("SELECT count(*) FROM profile_versions WHERE entry_id=?",Integer.class,UUID.fromString(id)));
    }
    @Test void scopeForgeryRevocationAndCsrfAreRejectedWithoutProfileDisclosure()throws Exception {
        UUID foreign=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'另一企业')",foreign);
        member.call("GET","/api/v1/tenants/"+foreign+"/profiles/PERSONAL/"+memberId,null,403);
        var pref=member.call("POST",base()+"/profiles/PERSONAL/"+memberId,profile("保留","PREFERENCE","私人内容","ACTIVE"),200);
        member.call("GET","/api/v1/tenants/"+foreign+"/profiles/entries/"+pref.get("id").asString(),null,403);
        member.call("GET","/api/v1/tenants/"+foreign+"/profiles/entries/"+UUID.randomUUID(),null,403);
        var r=member.send("POST",base()+"/profiles/PERSONAL/"+memberId,profile("未提交","FACT","未提交","ACTIVE"),false);assertEquals(403,r.statusCode());
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,memberId);
        member.call("GET",base()+"/profiles/entries/"+pref.get("id").asString(),null,403);
        owner.call("GET",base()+"/profiles/PERSONAL/"+memberId,null,404);
        assertEquals(0,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action LIKE '%私人内容%'",Integer.class,tenant));
    }
    @Test void disabledMemberCanLosePrivilegesWithoutRestoringTheirLogin()throws Exception {
        acceptOwner();owner.call("POST",governance()+"/members/"+memberId+"/role",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"role","TENANT_ADMIN"),200);
        var grant=new HashMap<String,Object>();grant.put("requestId",UUID.randomUUID());grant.put("expectedVersion",revision());grant.put("accountId",memberId);grant.put("workspaceId",null);grant.put("capability","TENANT_EXIT");grant.put("enabled",true);
        owner.call("POST",governance()+"/capabilities",grant,200);
        assertEquals(1,owner.call("GET",governance()+"/capabilities?accountId="+memberId,null,200).size());
        member.call("GET",governance()+"/capabilities?accountId="+memberId,null,403);
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,memberId);
        grant.put("requestId",UUID.randomUUID());grant.put("expectedVersion",revision());grant.put("enabled",false);owner.call("POST",governance()+"/capabilities",grant,200);
        owner.call("POST",governance()+"/members/"+memberId+"/role",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1,"role","MEMBER"),200);
        db.update("UPDATE tenant_memberships SET status='ACTIVE' WHERE tenant_id=? AND account_id=?",tenant,memberId);
        assertFalse(member.call("GET",governance(),null,200).get("canConfigure").asBoolean());assertFalse(access.allows(memberId,tenant,GovernanceAccess.Capability.TENANT_EXIT,null));
    }
    @Test void v15MigrationPreservesExistingAccessWithoutCreatingAuthorityOrProfiles() {
        String schema="governance_migration_"+UUID.randomUUID().toString().replace("-","");UUID a=UUID.randomUUID(),t=UUID.randomUUID(),w=UUID.randomUUID();
        try {
            org.flywaydb.core.Flyway.configure().dataSource(db.getDataSource()).schemas(schema).defaultSchema(schema).target("15").load().migrate();
            db.update("INSERT INTO "+schema+".accounts(id,email,display_name,password_hash) VALUES (?,'old@example.test','旧管理员','synthetic')",a);
            db.update("INSERT INTO "+schema+".tenants(id,name) VALUES (?,'旧企业')",t);
            db.update("INSERT INTO "+schema+".tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",t,a);
            db.update("INSERT INTO "+schema+".workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'旧共享','SHARED')",w,t,a);
            db.update("INSERT INTO "+schema+".workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",t,w,a);
            org.flywaydb.core.Flyway.configure().dataSource(db.getDataSource()).schemas(schema).defaultSchema(schema).target("16").load().migrate();
            assertEquals(0,db.queryForObject("SELECT count(*) FROM "+schema+".tenant_governance",Integer.class));
            assertEquals(0,db.queryForObject("SELECT count(*) FROM "+schema+".governance_initial_designations",Integer.class));
            assertEquals(0,db.queryForObject("SELECT count(*) FROM "+schema+".governance_capabilities",Integer.class));
            assertEquals(0,db.queryForObject("SELECT count(*) FROM "+schema+".profile_entries",Integer.class));
            assertTrue(db.queryForObject("SELECT can_maintain FROM "+schema+".workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",Boolean.class,t,w,a));
        } finally {db.execute("DROP SCHEMA IF EXISTS "+schema+" CASCADE");}
    }
    @Test void platformCanRecordLostOwnerCaseWithoutImpersonationOrSuccessfulRecovery()throws Exception {
        acceptOwner();db.update("UPDATE accounts SET status='DISABLED' WHERE id=?",ownerId);
        String p="/api/platform-admin/v1/tenants/"+tenant+"/governance-recovery-requests";
        var body=Map.of("requestId",UUID.randomUUID(),"reason","OWNER_UNAVAILABLE");
        var receipt=platform.call("POST",p,body,200);assertEquals("PENDING_VERIFICATION",receipt.get("status").asString());assertEquals(receipt,platform.call("POST",p,body,200));
        assertEquals(receipt,platform.call("GET",p+"/"+receipt.get("id").asString(),null,200));
        member.call("POST",p,body,403);platform.call("GET",base()+"/profiles/PERSONAL/"+ownerId,null,403);
        assertEquals(ownerId,db.queryForObject("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant));
        assertEquals("DISABLED",db.queryForObject("SELECT status FROM accounts WHERE id=?",String.class,ownerId));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE tenant_id=? AND account_id=?",Integer.class,tenant,platformId));
    }
}
