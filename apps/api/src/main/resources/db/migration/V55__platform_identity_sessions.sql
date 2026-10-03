-- Platform accounts have independent credentials. accounts retains the audit actor key only.
CREATE TABLE platform_accounts (
 account_id uuid PRIMARY KEY REFERENCES accounts(id),
 login_name varchar(254) NOT NULL UNIQUE CHECK(login_name=lower(trim(login_name))),
 password_hash varchar(255) NOT NULL,
 credential_version bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_sessions (
 token_hash char(64) PRIMARY KEY,
 csrf_hash char(64) NOT NULL,
 account_id uuid REFERENCES platform_accounts(account_id),
 credential_version bigint,
 expires_at timestamptz NOT NULL,
 CHECK ((account_id IS NULL) = (credential_version IS NULL))
);
CREATE INDEX platform_session_expiry ON platform_sessions(expires_at);
CREATE FUNCTION reject_platform_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM platform_accounts WHERE account_id=NEW.account_id) THEN
  RAISE EXCEPTION 'Platform identity cannot be a tenant member';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tenant_customer_identity BEFORE INSERT OR UPDATE ON tenant_memberships
 FOR EACH ROW EXECUTE FUNCTION reject_platform_membership();
-- Restoring a role/account must not resurrect a session issued before revocation.
CREATE FUNCTION revoke_platform_role_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM platform_sessions WHERE account_id=OLD.account_id;
 RETURN OLD;
END $$;
CREATE TRIGGER platform_role_session_revocation AFTER DELETE ON platform_roles
 FOR EACH ROW EXECUTE FUNCTION revoke_platform_role_sessions();
CREATE FUNCTION revoke_platform_credential_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM platform_sessions WHERE account_id=NEW.account_id;
 RETURN NEW;
END $$;
CREATE TRIGGER platform_credential_session_revocation AFTER UPDATE OF password_hash,credential_version ON platform_accounts
 FOR EACH ROW EXECUTE FUNCTION revoke_platform_credential_sessions();
CREATE FUNCTION revoke_platform_account_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM platform_sessions WHERE account_id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER platform_account_session_revocation AFTER UPDATE OF status ON accounts
 FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION revoke_platform_account_sessions();
