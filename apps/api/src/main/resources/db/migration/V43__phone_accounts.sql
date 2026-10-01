-- Preserve existing account IDs, password hashes, memberships and content owners.
ALTER TABLE accounts ALTER COLUMN email DROP NOT NULL;
ALTER TABLE accounts ADD COLUMN phone varchar(16) UNIQUE;
ALTER TABLE accounts ADD COLUMN phone_verified_at timestamptz;
ALTER TABLE accounts ADD COLUMN credential_version bigint NOT NULL DEFAULT 0 CHECK (credential_version >= 0);
ALTER TABLE accounts ADD CONSTRAINT account_contact_required CHECK (email IS NOT NULL OR phone IS NOT NULL);
ALTER TABLE accounts ADD CONSTRAINT account_phone_verified CHECK (
    (phone IS NULL AND phone_verified_at IS NULL) OR
    (phone IS NOT NULL AND phone ~ '^\+[1-9][0-9]{7,14}$' AND phone_verified_at IS NOT NULL));
ALTER TABLE invitations ALTER COLUMN email DROP NOT NULL;
ALTER TABLE invitations ADD COLUMN phone varchar(16);
ALTER TABLE invitations ADD CONSTRAINT invitation_one_contact CHECK ((email IS NULL) <> (phone IS NULL));
ALTER TABLE invitations ADD CONSTRAINT invitation_phone_format CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$');
CREATE UNIQUE INDEX one_pending_phone_invitation ON invitations(tenant_id,phone) WHERE status='PENDING';

CREATE TABLE phone_challenges (
    id uuid PRIMARY KEY,
    phone varchar(16) NOT NULL,
    purpose varchar(8) NOT NULL CHECK (purpose IN ('JOIN','BIND','RESET')),
    session_hash varchar(64) NOT NULL,
    account_id uuid REFERENCES accounts(id),
    invitation_id uuid REFERENCES invitations(id),
    code_hash text NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    verified_at timestamptz,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phone_challenges_browser ON phone_challenges(session_hash,phone,purpose,created_at);
