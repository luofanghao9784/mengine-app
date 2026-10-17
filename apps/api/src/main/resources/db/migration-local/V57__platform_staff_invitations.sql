ALTER TABLE platform_accounts ADD COLUMN management_version bigint NOT NULL DEFAULT 0;
CREATE TABLE platform_staff_invitations (
 id uuid PRIMARY KEY,
 login_name varchar(254) NOT NULL,
 token_hash char(64) NOT NULL UNIQUE,
 invited_by uuid NOT NULL REFERENCES platform_accounts(account_id),
 status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','REVOKED')),
 accepted_by uuid REFERENCES platform_accounts(account_id),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 CHECK ((status='ACCEPTED')=(accepted_by IS NOT NULL))
);
CREATE INDEX platform_staff_invitation_contact ON platform_staff_invitations(login_name,status);
