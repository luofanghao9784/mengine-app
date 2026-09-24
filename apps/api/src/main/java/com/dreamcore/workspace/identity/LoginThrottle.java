package com.dreamcore.workspace.identity;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LoginThrottle {
    private final JdbcTemplate db;
    private final int emailLimit;
    private final int ipLimit;
    public LoginThrottle(JdbcTemplate db, @Value("${dreamcore.auth.email-attempts:10}") int emailLimit,
                         @Value("${dreamcore.auth.ip-attempts:100}") int ipLimit) {
        this.db = db; this.emailLimit = emailLimit; this.ipLimit = ipLimit;
    }
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean allow(String email, String ip) {
        // Store bounded hashes, never submitted emails or user-controlled proxy headers.
        int byEmail = increment(IdentityService.hash("email:" + email));
        int byIp = increment(IdentityService.hash("ip:" + ip));
        db.update("DELETE FROM login_attempts WHERE window_start < now() - interval '1 day'");
        return byEmail <= emailLimit && byIp <= ipLimit;
    }
    private int increment(String bucket) {
        return db.queryForObject("""
            INSERT INTO login_attempts(bucket,window_start,attempts) VALUES (?,now(),1)
            ON CONFLICT (bucket) DO UPDATE SET
              attempts = CASE WHEN login_attempts.window_start < now() - interval '15 minutes' THEN 1 ELSE login_attempts.attempts + 1 END,
              window_start = CASE WHEN login_attempts.window_start < now() - interval '15 minutes' THEN now() ELSE login_attempts.window_start END
            RETURNING attempts
            """, Integer.class, bucket);
    }
}
