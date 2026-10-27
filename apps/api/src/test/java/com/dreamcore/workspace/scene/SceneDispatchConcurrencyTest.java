package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.identity.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class SceneDispatchConcurrencyTest {
    final SceneBridgeClient bridge = mock(SceneBridgeClient.class);
    final IdentityService identities = mock(IdentityService.class);
    final JdbcTemplate db = mock(JdbcTemplate.class);
    final SceneService scenes = new SceneService(bridge,db,identities,null,null,null,null,null);
    final UUID actor = UUID.randomUUID(), tenant = UUID.randomUUID();

    @Test void blockedReadDoesNotBlockAnotherTenantRead() throws Exception {
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-access"),isNull())).thenAnswer(i -> {
            entered.countDown(); assertTrue(release.await(5,TimeUnit.SECONDS)); return new JsonMapper().createObjectNode();
        });
        UUID otherTenant = UUID.randomUUID();
        var other = new JsonMapper().createObjectNode().put("tenant",otherTenant.toString());
        when(bridge.call(eq(otherTenant),anyString(),eq("GET"),eq("/scene-access"),isNull())).thenReturn(other);
        try(var pool = Executors.newFixedThreadPool(2)) {
            try {
                var slow = pool.submit(() -> scenes.dispatch(actor,tenant,false,"GET","/scene-access",null));
                assertTrue(entered.await(2,TimeUnit.SECONDS));
                assertEquals(other,pool.submit(() -> scenes.dispatch(actor,otherTenant,false,"GET","/scene-access",null)).get(1,TimeUnit.SECONDS));
                release.countDown(); slow.get(2,TimeUnit.SECONDS);
                verify(identities,times(2)).member(actor,otherTenant,false);
            } finally { release.countDown(); }
        }
    }

    @Test void writesExcludeReadsAndOtherWrites() throws Exception {
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        when(db.queryForObject(anyString(),eq(Boolean.class),eq(tenant))).thenReturn(true);
        when(db.queryForList(anyString(),eq(tenant))).thenReturn(List.of(Map.of("tenant_id",tenant)));
        when(bridge.call(eq(tenant),anyString(),eq("GET"),anyString(),isNull())).thenReturn(new JsonMapper().createObjectNode());
        when(bridge.call(eq(tenant),anyString(),eq("POST"),eq("/scene-knowledge/sync"),isNull())).thenAnswer(i -> {
            entered.countDown(); assertTrue(release.await(5,TimeUnit.SECONDS)); return new JsonMapper().createObjectNode();
        });
        try(var pool = Executors.newFixedThreadPool(3)) {
            try {
                var first = pool.submit(() -> scenes.dispatch(actor,tenant,false,"POST","/scene-knowledge/sync",null));
                assertTrue(entered.await(2,TimeUnit.SECONDS));
                var second = pool.submit(() -> scenes.dispatch(actor,tenant,false,"POST","/scene-knowledge/sync",null));
                assertThrows(TimeoutException.class,() -> second.get(150,TimeUnit.MILLISECONDS));
                var read = pool.submit(() -> scenes.dispatch(actor,tenant,false,"GET","/scene-access",null));
                assertThrows(TimeoutException.class,() -> read.get(150,TimeUnit.MILLISECONDS));
                verify(bridge,times(1)).call(eq(tenant),anyString(),eq("POST"),anyString(),isNull());
                release.countDown(); first.get(2,TimeUnit.SECONDS); second.get(2,TimeUnit.SECONDS); assertNotNull(read.get(2,TimeUnit.SECONDS));
            } finally { release.countDown(); }
        }
    }

    @Test void bridgePermissionChangeWaitsForInFlightReadEvenWhenTenantMembershipRemains() throws Exception {
        var service = spy(scenes);
        doReturn(Map.of()).when(service).synchronize(actor,tenant,false);
        var allowed = new java.util.concurrent.atomic.AtomicBoolean(true);
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        when(db.queryForObject(anyString(),eq(Boolean.class),eq(tenant))).thenReturn(true);
        when(db.queryForObject(anyString(),eq(UUID.class),eq(tenant))).thenReturn(actor);
        when(db.queryForList(anyString(),eq(tenant))).thenReturn(List.of(Map.of("tenant_id",tenant)));
        when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-knowledge"),isNull())).thenAnswer(i -> {
            boolean capturedPermission=allowed.get(); // Bridge captures its own user before an await.
            entered.countDown(); assertTrue(release.await(5,TimeUnit.SECONDS));
            if(!capturedPermission)throw IdentityException.denied();
            return new JsonMapper().createObjectNode().put("private","visible before revocation");
        });
        String policyPath="/scene-access/members/"+actor;
        when(bridge.call(eq(tenant),anyString(),eq("POST"),eq(policyPath),isNull())).thenAnswer(i -> {
            allowed.set(false); return new JsonMapper().createObjectNode();
        });
        try(var pool=Executors.newFixedThreadPool(2)) {
            try {
                var read=pool.submit(() -> service.dispatch(actor,tenant,false,"GET","/scene-knowledge",null));
                assertTrue(entered.await(2,TimeUnit.SECONDS));
                var revoke=pool.submit(() -> service.dispatch(actor,tenant,false,"POST",policyPath,null));
                assertThrows(TimeoutException.class,() -> revoke.get(150,TimeUnit.MILLISECONDS));
                assertTrue(allowed.get());
                release.countDown(); read.get(2,TimeUnit.SECONDS); revoke.get(2,TimeUnit.SECONDS);
                assertEquals(403,assertThrows(IdentityException.class,() -> service.dispatch(actor,tenant,false,"GET","/scene-knowledge",null)).status);
            } finally { release.countDown(); }
        }
    }

    @Test void membershipRevokedDuringReadPreventsResponse() {
        when(bridge.call(eq(tenant),anyString(),eq("GET"),anyString(),isNull())).thenAnswer(i -> {
            doThrow(IdentityException.denied()).when(identities).member(actor,tenant,false);
            return new JsonMapper().createObjectNode().put("private","must not escape");
        });
        assertEquals(403,assertThrows(IdentityException.class,() -> scenes.dispatch(actor,tenant,false,"GET","/scene-access",null)).status);
    }
}
