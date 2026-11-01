package com.dreamcore.workspace.qualityops;

import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;

@Repository
public class CheckTaskStore {
    private final JdbcClient db;
    private final JsonMapper json;

    public CheckTaskStore(JdbcClient db, JsonMapper json) {
        this.db = db;
        this.json = json;
    }

    public void insert(UUID id, UUID tenantId, UUID actor, String title, String materialText,
                       QualityCheckEngine.Result result) {
        String resultJson = json.writeValueAsString(result);
        db.sql("""
                insert into qo_check_task(id, tenant_id, created_by, title, material_text, status, result_json)
                values (:id, :tenant, :actor, :title, :material, 'COMPLETED', cast(:result as jsonb))
                """).param("id", id).param("tenant", tenantId).param("actor", actor)
                .param("title", title).param("material", materialText)
                .param("result", resultJson).update();
    }
}
