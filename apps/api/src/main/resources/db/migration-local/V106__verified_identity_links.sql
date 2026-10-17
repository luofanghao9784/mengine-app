-- Link provenance never rewrites old authors, actors, content references or password ownership.
CREATE TABLE unified_identity_links (
 source_id uuid PRIMARY KEY REFERENCES accounts(id),
 target_id uuid NOT NULL REFERENCES accounts(id),
 verified_by uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_id<>target_id),
 CHECK(verified_by=source_id)
);
CREATE INDEX unified_identity_target ON unified_identity_links(target_id);
