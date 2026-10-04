ALTER TABLE accounts ADD COLUMN management_version bigint NOT NULL DEFAULT 0 CHECK(management_version>=0);
CREATE TABLE platform_account_changes (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES platform_accounts(account_id),
 account_id uuid NOT NULL REFERENCES accounts(id),
 previous_status varchar(16) NOT NULL CHECK(previous_status IN ('ACTIVE','DISABLED')),
 next_status varchar(16) NOT NULL CHECK(next_status IN ('ACTIVE','DISABLED')),
 reason varchar(500) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_account_changes_history ON platform_account_changes(account_id,created_at DESC,id);
