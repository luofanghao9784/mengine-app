-- Fourth-end realm shares accounts/roles but has independent credentials and sessions.
ALTER TABLE platform_roles DROP CONSTRAINT platform_roles_role_check;
ALTER TABLE platform_roles ADD CONSTRAINT platform_roles_role_check CHECK (role IN ('PLATFORM_ADMIN','AGENT_ADMIN'));

-- Platform accounts have independent credentials. accounts retains the audit actor key only.
CREATE TABLE agent_platform_accounts (
 account_id uuid PRIMARY KEY REFERENCES accounts(id),
 login_name varchar(254) NOT NULL UNIQUE CHECK(login_name=lower(trim(login_name))),
 password_hash varchar(255) NOT NULL,
 credential_version bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_platform_sessions (
 token_hash char(64) PRIMARY KEY,
 csrf_hash char(64) NOT NULL,
 account_id uuid REFERENCES agent_platform_accounts(account_id),
 credential_version bigint,
 expires_at timestamptz NOT NULL,
 CHECK ((account_id IS NULL) = (credential_version IS NULL))
);
CREATE INDEX agent_platform_session_expiry ON agent_platform_sessions(expires_at);

-- Re-granting a role or restoring an account must not revive revoked sessions.
CREATE FUNCTION revoke_agent_role_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM agent_platform_sessions WHERE account_id=OLD.account_id;
 RETURN OLD;
END $$;
CREATE TRIGGER agent_role_session_revocation AFTER DELETE ON platform_roles
 FOR EACH ROW WHEN (OLD.role='AGENT_ADMIN') EXECUTE FUNCTION revoke_agent_role_sessions();
CREATE FUNCTION revoke_agent_credential_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM agent_platform_sessions WHERE account_id=NEW.account_id;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_credential_session_revocation AFTER UPDATE OF password_hash,credential_version ON agent_platform_accounts
 FOR EACH ROW EXECUTE FUNCTION revoke_agent_credential_sessions();
CREATE FUNCTION revoke_agent_account_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM agent_platform_sessions WHERE account_id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_account_session_revocation AFTER UPDATE OF status ON accounts
 FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION revoke_agent_account_sessions();
