package com.dreamcore.workspace.identity;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IdentityService {
    public record Account(UUID id, String email, String displayName, String phone,
                          @com.fasterxml.jackson.annotation.JsonIgnore long credentialVersion) {}
    public record Membership(UUID tenantId, String tenantName, String role) {}
    public record Me(Account account, boolean platformAdmin, List<Membership> memberships) {}
    public record Tenant(UUID id, String name, String status) {}
    public record Workspace(UUID id, String name, String kind) {}
    public record TenantContext(Tenant tenant, String role, List<Workspace> workspaces) {}
    public record Invitation(UUID id, UUID tenantId, String email, String role, String status, Instant expiresAt, String phone) {}
    public record TenantCreated(Tenant tenant, Invitation invitation) {}
    private static final RowMapper<Account> ACCOUNT = (r, n) -> new Account(r.getObject("id", UUID.class), r.getString("email"), r.getString("display_name"), r.getString("phone"),r.getLong("credential_version"));
    private static final RowMapper<Tenant> TENANT = (r, n) -> new Tenant(r.getObject("id", UUID.class), r.getString("name"), r.getString("status"));
    private static final RowMapper<Invitation> INVITATION = (r, n) -> new Invitation(r.getObject("id", UUID.class), r.getObject("tenant_id", UUID.class),
            r.getString("email"), r.getString("role"), r.getString("effective_status"), r.getTimestamp("expires_at").toInstant(), r.getString("phone"));
    private static final String INVITATION_SELECT = "SELECT *, CASE WHEN status='PENDING' AND expires_at<=now() THEN 'EXPIRED' ELSE status END AS effective_status FROM invitations";
    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final IdentityAudit audit;
    private final LoginThrottle throttle;
    private final LocalInvitationDelivery delivery;
    private final int ttlHours;
    private final SecureRandom random = new SecureRandom();
    private final String dummyHash;

    private final com.dreamcore.workspace.departure.DepartureAccess departure;
    public IdentityService(JdbcTemplate db, PasswordEncoder passwords, IdentityAudit audit, LoginThrottle throttle,
                           LocalInvitationDelivery delivery, @Value("${dreamcore.invitation.ttl-hours}") int ttlHours,com.dreamcore.workspace.departure.DepartureAccess departure) {this.departure=departure;
        this.db = db; this.passwords = passwords; this.audit = audit; this.throttle = throttle;
        this.delivery = delivery; this.ttlHours = ttlHours;
        this.dummyHash = passwords.encode(UUID.randomUUID().toString());
    }
    public static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    static String email(String value) {
        if (value == null) throw IdentityException.invalid();
        String normalized = value.strip().toLowerCase(Locale.ROOT);
        if (normalized.length() > 254 || !normalized.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) throw IdentityException.invalid();
        return normalized;
    }
    static String name(String value, int max) {
        if (value == null || value.isBlank() || value.strip().length() > max) throw IdentityException.invalid();
        return value.strip();
    }
    static void password(String value) {
        if (value == null || value.length() < 6 || value.length() > 128) throw new IdentityException(400, "PASSWORD_POLICY");
    }
    public boolean active(UUID account) {
        return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM accounts WHERE id=? AND status='ACTIVE')", Boolean.class, account));
    }
    public boolean validSession(UUID account,long version) {
        return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM accounts WHERE id=? AND status='ACTIVE' AND credential_version=?)",Boolean.class,account,version));
    }
    public Account login(String suppliedEmail, String password, String ip) {
        boolean byPhone = suppliedEmail != null && !suppliedEmail.contains("@");
        String normalized = byPhone ? PhoneNumbers.normalize(suppliedEmail) : email(suppliedEmail);
        if (!throttle.allow(normalized, ip)) { audit.denial(null, "LOGIN_THROTTLED"); throw new IdentityException(429, "LOGIN_THROTTLED"); }
        if (password == null || password.length() > 128) throw new IdentityException(401, "INVALID_CREDENTIALS");
        var rows = db.queryForList("SELECT id,password_hash,status,credential_version FROM accounts WHERE " + (byPhone ? "phone=?" : "email=? AND phone IS NULL"), normalized);
        String encoded = rows.isEmpty() ? dummyHash : (String) rows.getFirst().get("password_hash");
        boolean matches = passwords.matches(password, encoded);
        if (!matches || rows.isEmpty() || !"ACTIVE".equals(rows.getFirst().get("status"))) {
            audit.denial(null, "LOGIN_FAILED"); throw new IdentityException(401, "INVALID_CREDENTIALS");
        }
        UUID id = (UUID) rows.getFirst().get("id");
        audit.record(id, null, "LOGIN", id, "SUCCESS");
        var current=account(id);
        // Bind the new session to the password version that actually matched, even if a reset races.
        return new Account(current.id(),current.email(),current.displayName(),current.phone(),(Long)rows.getFirst().get("credential_version"));
    }
    public Account account(UUID id) {
        var rows = db.query("SELECT * FROM accounts WHERE id=? AND status='ACTIVE'", ACCOUNT, id);
        if (rows.isEmpty()) throw new IdentityException(401, "AUTHENTICATION_REQUIRED");
        return rows.getFirst();
    }
    public Me me(UUID actor) {
        return new Me(account(actor), isPlatformAdmin(actor), db.query("""
            SELECT t.id,t.name,m.role FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id
            WHERE m.account_id=? AND m.status='ACTIVE' AND t.status='ACTIVE' ORDER BY t.created_at,t.id
            """, (r,n) -> new Membership(r.getObject("id", UUID.class), r.getString("name"), r.getString("role")), actor));
    }
    private boolean isPlatformAdmin(UUID actor) {
        return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM platform_roles WHERE account_id=? AND role='PLATFORM_ADMIN')", Boolean.class, actor));
    }
    public void platform(UUID actor) {
        account(actor);
        if (!isPlatformAdmin(actor)) { audit.denial(actor, "PLATFORM_ACCESS"); throw IdentityException.denied(); }
    }
    public String member(UUID actor, UUID tenant, boolean admin) {
        return member(actor,tenant,admin,true);
    }
    public String member(UUID actor, UUID tenant, boolean admin, boolean lock) {
        account(actor);
        // Lock in a separate statement: a joined SELECT that waited on t could retain a stale
        // membership snapshot when the writer changed only m. Check current membership after waiting.
        if (lock) {
            db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE",tenant);
            // Account status can change while this request waits, just like tenant membership.
            account(actor);
        }
        var roles = db.queryForList("""
            SELECT m.role FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id
            WHERE m.tenant_id=? AND m.account_id=? AND m.status='ACTIVE' AND t.status='ACTIVE'
            """, String.class, tenant, actor);
        if (roles.isEmpty() || (admin && !"TENANT_ADMIN".equals(roles.getFirst()))) {
            audit.denial(actor, "TENANT_ACCESS"); throw IdentityException.denied();
        }
        return roles.getFirst();
    }
    @Transactional
    public TenantContext context(UUID actor, UUID tenant) {
        String role = member(actor, tenant, false);
        // Tenant admin and platform role do not confer access to another member's personal workspace.
        var spaces = db.query("""
            SELECT w.id,w.name,w.kind FROM workspaces w WHERE w.tenant_id=? AND
            ((w.kind='PERSONAL' AND w.owner_id=?) OR (w.kind='SHARED' AND EXISTS(SELECT 1 FROM workspace_members m
                WHERE m.tenant_id=w.tenant_id AND m.workspace_id=w.id AND m.account_id=?))) AND departure_content_readable(?,w.tenant_id,w.id) ORDER BY w.id
            """, (r,n) -> new Workspace(r.getObject("id", UUID.class),r.getString("name"),r.getString("kind")), tenant, actor, actor, actor);
        return new TenantContext(tenant(tenant), role, spaces);
    }
    public List<Tenant> tenants(UUID actor) { platform(actor); return db.query("SELECT * FROM tenants ORDER BY created_at,id", TENANT); }
    private Tenant tenant(UUID id) { return db.queryForObject("SELECT * FROM tenants WHERE id=?", TENANT, id); }
    Invitation invitation(UUID id) { return db.queryForObject(INVITATION_SELECT + " WHERE id=?", INVITATION, id); }

    @Transactional
    public UUID bootstrap(String suppliedEmail, String displayName, String password) {
        String normalized = email(suppliedEmail); String display = name(displayName,80); password(password);
        db.execute("SELECT pg_advisory_xact_lock(743012009)");
        if (db.queryForObject("SELECT count(*) FROM platform_roles", Integer.class) != 0) throw new IdentityException(409, "BOOTSTRAP_ALREADY_COMPLETED");
        if (db.queryForObject("SELECT count(*) FROM accounts WHERE email=?", Integer.class, normalized) != 0) throw IdentityException.conflict();
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,normalized,display,passwords.encode(password));
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",id);
        audit.record(id,null,"PLATFORM_BOOTSTRAP",id,"SUCCESS");
        return id;
    }

    @Transactional
    public TenantCreated createTenant(UUID actor, UUID requestId, String tenantName, String adminEmail) {
        return createTenant(actor,requestId,tenantName,adminEmail,false);
    }
    @Transactional
    public TenantCreated createTenant(UUID actor, UUID requestId, String tenantName, String adminEmail, boolean designateOwner) {
        platform(actor); String display = name(tenantName,100); String normalized = adminEmail != null && adminEmail.contains("@") ? email(adminEmail) : PhoneNumbers.normalize(adminEmail);
        String fingerprint = hash(display + "\n" + normalized + (designateOwner ? "\nOWNER_DESIGNATED" : ""));
        UUID prior = priorRequest(actor,requestId,"CREATE_TENANT",fingerprint);
        platform(actor); // The request key may have waited while platform access was revoked.
        if (prior != null) {
            UUID invite = db.queryForObject("SELECT invitation_id FROM tenant_initial_admin WHERE tenant_id=?",UUID.class,prior);
            return new TenantCreated(tenant(prior),invitation(invite));
        }
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO tenants(id,name) VALUES (?,?)",id,display);
        Invitation invite = issue(actor,id,normalized,"TENANT_ADMIN");
        db.update("INSERT INTO tenant_initial_admin(tenant_id,invitation_id) VALUES (?,?)",id,invite.id());
        if(designateOwner) db.update("INSERT INTO governance_initial_designations(tenant_id,invitation_id,designated_by) VALUES (?,?,?)",id,invite.id(),actor);
        remember(actor,requestId,"CREATE_TENANT",fingerprint,id);
        audit.record(actor,id,"TENANT_CREATE",id,"SUCCESS");
        return new TenantCreated(tenant(id),invite);
    }
    @Transactional
    public Invitation invite(UUID actor, UUID tenant, UUID requestId, String suppliedEmail) {
        member(actor,tenant,true,false); String normalized = suppliedEmail != null && suppliedEmail.contains("@") ? email(suppliedEmail) : PhoneNumbers.normalize(suppliedEmail);
        String fingerprint = hash(tenant + "\n" + normalized);
        UUID prior = priorRequest(actor,requestId,"INVITE_MEMBER",fingerprint);
        member(actor,tenant,true);
        if (prior != null) return invitation(prior);
        Invitation result = issue(actor,tenant,normalized,"MEMBER");
        remember(actor,requestId,"INVITE_MEMBER",fingerprint,result.id());
        return result;
    }
    Invitation issue(UUID actor, UUID tenant, String email, String role) {
        departure.requireActiveBusiness(actor,tenant);
        boolean byPhone = email.startsWith("+");
        String contactColumn = byPhone ? "phone" : "email";
        if (db.queryForObject("SELECT count(*) FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id WHERE m.tenant_id=? AND a." + contactColumn + "=?",Integer.class,tenant,email) > 0) throw IdentityException.conflict();
        // Expiration is also derived on read; this update releases the unique pending-invite slot.
        db.update("UPDATE invitations SET status='EXPIRED' WHERE tenant_id=? AND " + contactColumn + "=? AND status='PENDING' AND expires_at<=now()",tenant,email);
        UUID id = UUID.randomUUID(); byte[] bytes = new byte[32]; random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        db.update("INSERT INTO invitations(id,tenant_id," + contactColumn + ",role,token_hash,expires_at,created_by) VALUES (?,?,?,?,?,now() + make_interval(hours => ?),?)",
                id,tenant,email,role,hash(token),ttlHours,actor);
        delivery.deliver(id,email,token);
        audit.record(actor,tenant,"INVITATION_CREATE",id,"SUCCESS");
        return invitation(id);
    }
    @Transactional
    public List<Invitation> invitations(UUID actor, UUID tenant, int offset, int limit) {
        member(actor,tenant,true);
        TenantAdminService.page(offset,limit);
        return db.query(INVITATION_SELECT + " WHERE tenant_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",INVITATION,tenant,limit,offset);
    }
    @Transactional
    public void revoke(UUID actor, UUID tenant, UUID id) {
        member(actor,tenant,true);
        var rows = db.queryForList("SELECT status FROM invitations WHERE id=? AND tenant_id=? FOR UPDATE",String.class,id,tenant);
        if (rows.isEmpty()) throw new IdentityException(404,"INVITATION_NOT_FOUND");
        if ("ACCEPTED".equals(rows.getFirst())) throw IdentityException.conflict();
        if ("REVOKED".equals(rows.getFirst())) return;
        db.update("UPDATE invitations SET status='REVOKED' WHERE id=? AND tenant_id=?",id,tenant);
        audit.record(actor,tenant,"INVITATION_REVOKE",id,"SUCCESS");
    }
    @Transactional
    public Membership accept(UUID actor, String token, String displayName, String password) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) throw new IdentityException(400,"INVITATION_INVALID");
        var candidate = db.query(INVITATION_SELECT + " WHERE token_hash=?",INVITATION,hash(token));
        if (candidate.isEmpty()) throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        // All invitation mutations lock the tenant before an invitation, avoiding lock inversion.
        var statuses = db.queryForList("SELECT status FROM tenants WHERE id=? FOR SHARE",String.class,candidate.getFirst().tenantId());
        if (statuses.isEmpty() || !"ACTIVE".equals(statuses.getFirst())) throw IdentityException.denied();
        var invites = db.query(INVITATION_SELECT + " WHERE token_hash=? FOR UPDATE",INVITATION,hash(token));
        if (invites.isEmpty() || !"PENDING".equals(invites.getFirst().status())) throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        Invitation invite = invites.getFirst();
        if (invite.phone() != null) throw new IdentityException(400,"PHONE_VERIFICATION_REQUIRED");
        departure.requireTenantActivation(invite.tenantId());
        // Serialize two invitations for the same new account without overwriting credentials.
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", "account:" + invite.email());
        var existing = db.query("SELECT * FROM accounts WHERE email=? FOR UPDATE",ACCOUNT,invite.email());
        UUID accountId;
        if (!existing.isEmpty()) {
            accountId = existing.getFirst().id();
            if (!accountId.equals(actor) || !active(accountId)) throw new IdentityException(403,"INVITATION_ACCOUNT_LOGIN_REQUIRED");
            if (password != null || displayName != null) throw new IdentityException(400,"EXISTING_ACCOUNT_CREDENTIALS_NOT_ALLOWED");
        } else {
            if (actor != null) throw new IdentityException(403,"INVITATION_ACCOUNT_MISMATCH");
            password(password); String display = name(displayName,80); accountId = UUID.randomUUID();
            db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",accountId,invite.email(),display,passwords.encode(password));
        }
        departure.requireMemberActivation(invite.tenantId(),accountId);
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",invite.tenantId(),accountId,invite.role());
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人空间','PERSONAL')",UUID.randomUUID(),invite.tenantId(),accountId);
        db.update("UPDATE invitations SET status='ACCEPTED',accepted_by=? WHERE id=?",accountId,invite.id());
        audit.record(accountId,invite.tenantId(),"INVITATION_ACCEPT",invite.id(),"SUCCESS");
        return new Membership(invite.tenantId(),tenant(invite.tenantId()).name(),invite.role());
    }
    public UUID priorRequest(UUID actor, UUID requestId, String operation, String fingerprint) {
        if (requestId == null) throw IdentityException.invalid();
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", "request:" + actor + ":" + requestId);
        var prior = db.queryForList("SELECT * FROM identity_requests WHERE actor_id=? AND request_id=?",actor,requestId);
        if (prior.isEmpty()) return null;
        if (!operation.equals(prior.getFirst().get("operation")) || !fingerprint.equals(prior.getFirst().get("fingerprint"))) throw new IdentityException(409,"IDEMPOTENCY_CONFLICT");
        return (UUID) prior.getFirst().get("target_id");
    }
    public void remember(UUID actor, UUID requestId, String operation, String fingerprint, UUID target) {
        db.update("INSERT INTO identity_requests(actor_id,request_id,operation,fingerprint,target_id) VALUES (?,?,?,?,?)",actor,requestId,operation,fingerprint,target);
    }
}
