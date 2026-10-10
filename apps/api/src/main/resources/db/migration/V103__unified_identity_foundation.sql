-- Preserve actor IDs, passwords, grants and original audit records. No implicit identity merging.
DROP TRIGGER tenant_customer_identity ON tenant_memberships;
DROP FUNCTION reject_platform_membership();

-- These rows now lease explicitly entered support contexts, never authenticate a cookie.
DELETE FROM platform_sessions;
ALTER TABLE platform_sessions DROP CONSTRAINT platform_sessions_account_id_fkey;
ALTER TABLE platform_sessions ADD FOREIGN KEY(account_id) REFERENCES accounts(id);

-- Invalidate pre-transition customer sessions without changing either password.
UPDATE accounts SET credential_version=credential_version+1;

CREATE FUNCTION invalidate_unified_platform_password() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE accounts SET credential_version=credential_version+1 WHERE id=NEW.account_id;
 RETURN NEW;
END $$;
CREATE TRIGGER unified_platform_password_change AFTER UPDATE OF password_hash,credential_version
 ON platform_accounts FOR EACH ROW EXECUTE FUNCTION invalidate_unified_platform_password();

CREATE FUNCTION invalidate_unified_support_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM platform_sessions WHERE account_id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER unified_credential_change AFTER UPDATE OF credential_version ON accounts
 FOR EACH ROW WHEN (OLD.credential_version IS DISTINCT FROM NEW.credential_version)
 EXECUTE FUNCTION invalidate_unified_support_sessions();


-- Management audit references identify people, not the presence of optional dedicated credentials.
ALTER TABLE platform_staff_invitations DROP CONSTRAINT platform_staff_invitations_invited_by_fkey;
ALTER TABLE platform_staff_invitations ADD FOREIGN KEY(invited_by) REFERENCES accounts(id);
ALTER TABLE platform_staff_invitations DROP CONSTRAINT platform_staff_invitations_accepted_by_fkey;
ALTER TABLE platform_staff_invitations ADD FOREIGN KEY(accepted_by) REFERENCES accounts(id);
ALTER TABLE platform_account_changes DROP CONSTRAINT platform_account_changes_actor_id_fkey;
ALTER TABLE platform_account_changes ADD FOREIGN KEY(actor_id) REFERENCES accounts(id);

CREATE OR REPLACE FUNCTION headquarters_permission_actor(principal uuid,tenant uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT g.owner_id FROM headquarters_support_access s
 JOIN platform_sessions p ON p.token_hash=s.session_hash AND p.account_id=s.actor_id AND p.expires_at>now()
 JOIN accounts a ON a.id=s.actor_id AND a.status='ACTIVE' AND a.credential_version=p.credential_version
 JOIN tenant_governance g ON g.tenant_id=s.tenant_id
 JOIN tenant_memberships m ON m.tenant_id=s.tenant_id AND m.account_id=g.owner_id AND m.status='ACTIVE'
 JOIN accounts o ON o.id=g.owner_id AND o.status='ACTIVE'
 WHERE s.id=nullif(current_setting('dreamcore.support_access',true),'')::uuid
 AND s.actor_id=principal AND s.tenant_id=tenant AND s.closed_at IS NULL
 AND EXISTS(SELECT 1 FROM platform_roles r WHERE r.account_id=s.actor_id AND r.role='PLATFORM_ADMIN')),principal);
$$;

CREATE OR REPLACE FUNCTION headquarters_source_permission_actor(principal uuid,tenant uuid,source uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT g.owner_id FROM headquarters_support_changes c
 JOIN headquarters_support_access s ON s.id=c.access_id AND s.actor_id=principal AND s.tenant_id=tenant AND s.closed_at IS NULL
 JOIN platform_sessions p ON p.token_hash=s.session_hash AND p.account_id=principal AND p.expires_at>now()
 JOIN accounts a ON a.id=principal AND a.status='ACTIVE' AND a.credential_version=p.credential_version
 JOIN tenant_governance g ON g.tenant_id=tenant
 JOIN tenant_memberships m ON m.tenant_id=tenant AND m.account_id=g.owner_id AND m.status='ACTIVE'
 JOIN accounts o ON o.id=g.owner_id AND o.status='ACTIVE'
 WHERE c.object_id=source::text AND EXISTS(SELECT 1 FROM platform_roles r WHERE r.account_id=principal AND r.role='PLATFORM_ADMIN')
 ORDER BY c.id LIMIT 1),principal);
$$;

ALTER TABLE tenant_service_changes DROP CONSTRAINT tenant_service_changes_actor_id_fkey;
ALTER TABLE tenant_service_changes ADD FOREIGN KEY(actor_id) REFERENCES accounts(id);

CREATE OR REPLACE FUNCTION platform_general_adjustment_available(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE a general_experience_adjustments%ROWTYPE;
BEGIN
 SELECT * INTO a FROM general_experience_adjustments WHERE id=target AND state IN ('QUEUED','RETRY_WAIT','RUNNING','UNCERTAIN','PUBLISHING');
 IF NOT FOUND OR a.content IS NULL THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM accounts x JOIN platform_roles r ON r.account_id=x.id AND r.role='PLATFORM_ADMIN' WHERE x.id=a.actor_id AND x.status='ACTIVE') THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM general_experience_entries e WHERE e.id=a.entry_id AND e.revision=a.expected_revision AND e.published_version=a.version_id AND e.status='AVAILABLE') THEN RETURN false; END IF;
 RETURN general_experience_available(a.version_id);
END $$;
