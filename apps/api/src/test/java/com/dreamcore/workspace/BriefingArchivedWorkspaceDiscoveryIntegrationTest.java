package com.dreamcore.workspace;

import com.dreamcore.workspace.briefing.BriefingGenerationService;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties = {
    "dreamcore.briefing.enabled=false",
    "dreamcore.company-analysis.enabled=false"
})
@Transactional
class BriefingArchivedWorkspaceDiscoveryIntegrationTest {
    @Autowired JdbcTemplate db;
    @Autowired BriefingGenerationService generation;

    @Test void archivedSpaceDoesNotBlockActiveSharedAndPersonalDiscovery() {
        UUID tenant = UUID.randomUUID(), actor = UUID.randomUUID();
        UUID archived = UUID.randomUUID(), shared = UUID.randomUUID(), personal = UUID.randomUUID();
        db.update("INSERT INTO tenants(id,name) VALUES (?,?)", tenant, "合成归档发现回归");
        db.update("""
            INSERT INTO accounts(id,email,display_name,password_hash)
            VALUES (?,?,?,'test-only')
            """, actor, actor + "@example.test", "合成管理员");
        db.update("""
            INSERT INTO tenant_memberships(tenant_id,account_id,role)
            VALUES (?,?,'TENANT_ADMIN')
            """, tenant, actor);
        sharedSpace(tenant, actor, archived, "待归档空空间");
        db.update("UPDATE workspaces SET archived=true WHERE id=?", archived);
        sharedSpace(tenant, actor, shared, "正常共享空间");
        db.update("""
            INSERT INTO workspaces(id,tenant_id,owner_id,name,kind)
            VALUES (?,?,?,?,'PERSONAL')
            """, personal, tenant, actor, "正常私人空间");

        assertEquals(Boolean.TRUE, db.queryForObject(
            "SELECT archived FROM workspaces WHERE id=?", Boolean.class, archived));
        assertEquals(0, policies(tenant, actor, archived));
        assertEquals(0, policies(tenant, actor, shared));
        assertEquals(0, policies(tenant, actor, personal));

        assertDoesNotThrow(() -> generation.discover());
        assertEquals(0, policies(tenant, actor, archived));
        assertEquals(1, policies(tenant, actor, shared));
        assertEquals(1, policies(tenant, actor, personal));

        assertDoesNotThrow(() -> generation.discover());
        assertEquals(0, policies(tenant, actor, archived));
        assertEquals(1, policies(tenant, actor, shared));
        assertEquals(1, policies(tenant, actor, personal));
        System.out.printf("DISCOVERY_COUNTS archived=%d shared=%d personal=%d afterRepeatedDiscover%n",
            policies(tenant, actor, archived), policies(tenant, actor, shared), policies(tenant, actor, personal));
    }

    private void sharedSpace(UUID tenant, UUID actor, UUID id, String name) {
        db.update("""
            INSERT INTO workspaces(id,tenant_id,owner_id,name,kind)
            VALUES (?,?,?,?,'SHARED')
            """, id, tenant, actor, name);
        db.update("""
            INSERT INTO workspace_members(tenant_id,workspace_id,account_id)
            VALUES (?,?,?)
            """, tenant, id, actor);
    }

    private int policies(UUID tenant, UUID actor, UUID workspace) {
        return db.queryForObject("""
            SELECT count(*) FROM briefing_generation_policies
            WHERE tenant_id=? AND owner_id=? AND workspace_id=?
            """, Integer.class, tenant, actor, workspace);
    }
}
