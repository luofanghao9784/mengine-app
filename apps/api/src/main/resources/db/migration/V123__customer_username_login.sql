-- Explicitly provisioned usernames share the existing account password and access checks.
ALTER TABLE accounts ADD COLUMN username varchar(40) UNIQUE;
ALTER TABLE accounts ADD CONSTRAINT account_username_format CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9_-]{2,39}$');
ALTER TABLE accounts DROP CONSTRAINT account_contact_required;
ALTER TABLE accounts ADD CONSTRAINT account_contact_required CHECK (email IS NOT NULL OR phone IS NOT NULL OR username IS NOT NULL);
