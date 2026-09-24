package com.dreamcore.workspace.identity;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IdentityAudit {
    private final JdbcTemplate db;
    public IdentityAudit(JdbcTemplate db) { this.db = db; }
    public void record(UUID actor, UUID tenant, String action, UUID target, String outcome) {
        db.update("INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome) VALUES (?,?,?,?,?)",
                actor, tenant, action, target, outcome);
    }
    // Failed requests roll back their business transaction, but their audit must survive.
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void denial(UUID actor, String action) { record(actor, null, action, null, "DENIED"); }
}
