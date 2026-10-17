-- Platform management receipts contain no contributing tenant or task identity.
CREATE TABLE general_experience_management_events (
 id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES accounts(id),request_id uuid NOT NULL,
 entry_id uuid NOT NULL REFERENCES general_experience_entries(id),version_id uuid NOT NULL REFERENCES general_experience_versions(id),
 expected_revision integer NOT NULL CHECK(expected_revision>0),revision integer NOT NULL CHECK(revision>1),
 status varchar(16) NOT NULL CHECK(status IN ('AVAILABLE','STOPPED')),
 reason varchar(500) NOT NULL CHECK(length(btrim(reason))>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,request_id),UNIQUE(entry_id,revision)
);
CREATE INDEX general_experience_management_latest ON general_experience_management_events(entry_id,revision DESC);
