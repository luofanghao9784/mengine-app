package com.dreamcore.workspace;

import java.util.HashSet;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;
import static org.junit.jupiter.api.Assertions.*;

@Transactional
class CompanyAnalysisDiscoveryTest extends CompanyAnalysisFixture {
    private static final String PREVIOUS_QUERY = """
        SELECT c.id FROM knowledge_chunks c JOIN knowledge_runs r ON r.id=c.run_id
        JOIN materials m ON m.id=c.material_id JOIN material_versions v ON v.id=c.version_id
        WHERE v.number=m.current_version
        AND r.generation=(SELECT max(x.generation) FROM knowledge_runs x WHERE x.version_id=c.version_id)
        AND company_chunk_eligible(c.id) AND c.tenant_id=?
        """;

    @Test void checksPermissionsPerRunInsteadOfPerChunk() {
        db.update("""
            INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content)
            SELECT gen_random_uuid(),c.tenant_id,c.workspace_id,c.material_id,c.version_id,c.run_id,n,'合成分块','TEXT','合成企业资料'
            FROM knowledge_chunks c CROSS JOIN generate_series(1,4000) n WHERE c.id=?
            """, chunk);
        countPermissionChecks();
        int runs = db.queryForObject("SELECT count(*) FROM knowledge_runs", Integer.class);
        assertEquals(4001, db.queryForObject("SELECT count(*) FROM company_analysis_discovery_chunks WHERE tenant_id=?", Integer.class, tenant));
        long calls = db.queryForObject("SELECT last_value FROM pg_temp.company_eligibility_calls", Long.class);
        System.out.println("Company discovery synthetic probe: chunks=4001, permissionCalls=" + calls + ", totalRuns=" + runs);
        assertTrue(calls <= runs, "Permission checks must be bounded by runs, observed " + calls + " for " + runs + " runs");

        // Exercise the production query shape with no pending work and many cancelled items.
        db.update("INSERT INTO company_analysis_items(chunk_id,tenant_id,state) SELECT id,tenant_id,'CANCELLED' FROM knowledge_chunks WHERE tenant_id=?", tenant);
        db.queryForObject("SELECT setval('pg_temp.company_eligibility_calls',1,false)", Long.class);
        queue.discover();
        long discoveryCalls = db.queryForObject("SELECT last_value FROM pg_temp.company_eligibility_calls", Long.class);
        assertEquals(4001,db.queryForObject("SELECT count(*) FROM company_analysis_items WHERE tenant_id=? AND state='QUEUED'",Integer.class,tenant));
        assertTrue(discoveryCalls <= 3L*runs,"Three discovery statements must not repeat permissions per queued item: " + discoveryCalls);
        System.out.println("Company discovery cancelled-item probe: items=4001, permissionCalls=" + discoveryCalls);
    }

    @Test void targetedEligibilityLookupDoesNotEvaluateUnrelatedRuns() {
        for(int i=0;i<6;i++)source(space);
        countPermissionChecks();
        assertEquals(chunk,db.queryForObject("SELECT id FROM company_analysis_current_chunks WHERE id=?",UUID.class,chunk));
        assertEquals(1L,db.queryForObject("SELECT last_value FROM pg_temp.company_eligibility_calls",Long.class));
    }

    @Test void preservesCurrentGenerationAndLivePermissionFiltering() {
        UUID privateChunk = source(personal), unpublished = source(space), partial = source(space);
        db.update("UPDATE materials SET in_library=false WHERE id=(SELECT material_id FROM knowledge_chunks WHERE id=?)", unpublished);
        db.update("UPDATE knowledge_runs SET status='PARTIAL' WHERE id=(SELECT run_id FROM knowledge_chunks WHERE id=?)", partial);
        db.update("""
            INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content)
            SELECT gen_random_uuid(),tenant_id,workspace_id,material_id,version_id,run_id,1,'空分块','TEXT','' FROM knowledge_chunks WHERE id=?
            """, chunk);
        assertEquivalent();
        assertFalse(current().contains(privateChunk)); assertFalse(current().contains(unpublished));
        assertTrue(current().contains(partial)); assertTrue(current().contains(chunk));

        // Empty first chunk still allows later nonempty chunks in the same run.
        db.update("UPDATE knowledge_chunks SET content=CASE WHEN ordinal=0 THEN '' ELSE '非空后续分块' END WHERE run_id=(SELECT run_id FROM knowledge_chunks WHERE id=?)", chunk);
        assertEquivalent(); assertFalse(current().contains(chunk));
        assertEquals(2, current().size());

        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?", space, reader);
        assertEquivalent(); assertTrue(current().isEmpty());
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)", tenant, space, reader);
        assertEquivalent(); assertEquals(2, current().size());

        UUID next = UUID.randomUUID();
        db.update("""
            INSERT INTO knowledge_runs(id,tenant_id,workspace_id,material_id,version_id,generation,requested_by,status)
            SELECT ?,tenant_id,workspace_id,material_id,version_id,generation+1,requested_by,'QUEUED' FROM knowledge_runs
            WHERE id=(SELECT run_id FROM knowledge_chunks WHERE id=?)
            """, next, partial);
        assertEquivalent(); assertFalse(current().contains(partial));
        db.update("UPDATE materials SET current_version=current_version+1 WHERE id=(SELECT material_id FROM knowledge_chunks WHERE id=?)", chunk);
        assertEquivalent(); assertTrue(current().isEmpty());
    }

    private HashSet<UUID> current() {
        return new HashSet<>(db.queryForList("SELECT id FROM company_analysis_discovery_chunks WHERE tenant_id=?", UUID.class, tenant));
    }
    private void assertEquivalent() { assertEquals(new HashSet<>(db.queryForList(PREVIOUS_QUERY, UUID.class, tenant)), current()); }
    private void countPermissionChecks() {
        // Instrument only this rollback-only test transaction; preserve the original policy implementation.
        String original = db.queryForObject("SELECT pg_get_functiondef('company_chunk_eligible(uuid)'::regprocedure)", String.class);
        db.execute(original.replace("FUNCTION public.company_chunk_eligible(", "FUNCTION public.test_original_company_chunk_eligible("));
        db.execute("CREATE TEMP SEQUENCE company_eligibility_calls");
        db.execute("""
            CREATE OR REPLACE FUNCTION company_chunk_eligible(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
            BEGIN
              PERFORM nextval('pg_temp.company_eligibility_calls');
              RETURN test_original_company_chunk_eligible(target);
            END $$
            """);
    }
}
