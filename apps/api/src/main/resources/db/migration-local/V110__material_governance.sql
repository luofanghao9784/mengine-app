-- Immutable, version-bound rule checks. No permission, classification or publication changes.
CREATE TABLE material_governance_reports (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, material_id uuid NOT NULL,
 version_id uuid NOT NULL, run_id uuid, parse_status varchar(16), revision integer NOT NULL CHECK(revision>0),
 source varchar(24) NOT NULL CHECK(source IN('ORIGINAL_TEXT','PARSED_TEXT','PARTIAL_TEXT','NO_TEXT')),
 issues text[] NOT NULL, tags text[] NOT NULL, review_at date,
 actor_id uuid NOT NULL REFERENCES accounts(id), checked_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id,material_id,version_id) REFERENCES material_versions(tenant_id,workspace_id,material_id,id),
 UNIQUE(tenant_id,material_id,revision)
);
CREATE INDEX material_governance_current ON material_governance_reports(tenant_id,material_id,revision DESC);
