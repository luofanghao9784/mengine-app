package com.dreamcore.workspace.identity;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PhoneVerificationService {
    public record Receipt(UUID id, Instant expiresAt, int retryAfterSeconds, String delivery, boolean localPreview) {}
    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final LocalPhoneDelivery delivery;
    private final LoginThrottle throttle;
    private final SecureRandom random = new SecureRandom();
    public PhoneVerificationService(JdbcTemplate db, PasswordEncoder passwords, LocalPhoneDelivery delivery, LoginThrottle throttle) {
        this.db=db; this.passwords=passwords; this.delivery=delivery; this.throttle=throttle;
    }
    @Transactional
    public Receipt issue(String phone, String purpose, String browser, UUID account, UUID invitation, boolean eligible, String ip) {
        delivery.requireEnabled();
        if (!List.of("JOIN","BIND","RESET","STAFF").contains(purpose)) throw IdentityException.invalid();
        String scope=IdentityService.hash(browser);
        // Phone-wide cooldown prevents using new browsers to bypass resend limits.
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","sms:"+phone);
        if (db.queryForObject("SELECT count(*) FROM phone_challenges WHERE phone=? AND created_at>now()-interval '60 seconds'",Integer.class,phone)>0)
            throw new IdentityException(429,"SMS_COOLDOWN");
        if (!throttle.allow("sms:"+phone,"sms:"+ip)) throw new IdentityException(429,"SMS_THROTTLED");
        db.update("DELETE FROM phone_challenges WHERE expires_at < now()-interval '1 day'");
        db.update("UPDATE phone_challenges SET consumed_at=now() WHERE session_hash=? AND phone=? AND purpose=? AND consumed_at IS NULL",scope,phone,purpose);
        UUID id=UUID.randomUUID(); String code=String.format(java.util.Locale.ROOT,"%06d",random.nextInt(1_000_000));
        Instant expires=Instant.now().plusSeconds(300);
        db.update("INSERT INTO phone_challenges(id,phone,purpose,session_hash,account_id,invitation_id,code_hash,expires_at) VALUES (?,?,?,?,?,?,?,?)",
            id,phone,purpose,scope,account,invitation,passwords.encode(code),java.sql.Timestamp.from(expires));
        if (eligible) delivery.deliver(id,phone,code);
        return new Receipt(id,expires,60,delivery.mode(),delivery.previewEnabled(ip));
    }
    /** Failed attempts commit even when the enclosing join/reset operation is rejected. */
    @Transactional(propagation=Propagation.REQUIRES_NEW, noRollbackFor=IdentityException.class)
    public void verify(UUID id, String code, String purpose, String browser) {
        if (id==null || code==null || !code.matches("[0-9]{6}")) throw new IdentityException(400,"CODE_INVALID");
        var rows=db.queryForList("SELECT * FROM phone_challenges WHERE id=? AND purpose=? AND session_hash=? AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",id,purpose,IdentityService.hash(browser));
        if(rows.isEmpty()) throw new IdentityException(400,"CODE_INVALID");
        var row=rows.getFirst(); int attempts=(Integer)row.get("attempts");
        if(attempts>=5) throw new IdentityException(429,"CODE_ATTEMPTS_EXCEEDED");
        if(!passwords.matches(code,(String)row.get("code_hash"))) {
            db.update("UPDATE phone_challenges SET attempts=attempts+1 WHERE id=?",id);
            throw new IdentityException(400,"CODE_INVALID");
        }
        db.update("UPDATE phone_challenges SET verified_at=now() WHERE id=?",id);
    }
    /** Caller transaction consumes the proof atomically with the account mutation. */
    public void consume(UUID id, String phone, String purpose, String browser, UUID account, UUID invitation) {
        int changed=db.update("""
            UPDATE phone_challenges SET consumed_at=now() WHERE id=? AND phone=? AND purpose=? AND session_hash=?
            AND account_id IS NOT DISTINCT FROM ?::uuid AND invitation_id IS NOT DISTINCT FROM ?::uuid
            AND verified_at IS NOT NULL AND consumed_at IS NULL AND expires_at>now() AND attempts<5
            """,id,phone,purpose,IdentityService.hash(browser),account,invitation);
        if(changed!=1) throw new IdentityException(400,"CODE_INVALID");
    }
    public String localCode(UUID id,String browser,String ip) {
        boolean owns=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM phone_challenges WHERE id=? AND session_hash=? AND consumed_at IS NULL AND expires_at>now())",Boolean.class,id,IdentityService.hash(browser)));
        if(!owns) throw new IdentityException(404,"CODE_UNAVAILABLE");
        return delivery.localCode(id,ip);
    }
}
