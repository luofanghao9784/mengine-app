CREATE TABLE material_governance_proposals (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),material_id uuid NOT NULL REFERENCES materials(id),
 version_id uuid NOT NULL REFERENCES material_versions(id),run_id uuid REFERENCES knowledge_runs(id),
 base_revision integer NOT NULL,kind varchar(12) NOT NULL CHECK(kind IN ('TAGS','SUMMARY')),
 patch jsonb,reason text NOT NULL,actor_id uuid NOT NULL REFERENCES accounts(id),
 status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPLIED','REJECTED')),
 resolved_by uuid REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz
);
CREATE INDEX governance_proposal_inbox ON material_governance_proposals(tenant_id,created_at DESC,id);
CREATE TABLE material_summary_versions (
 material_id uuid NOT NULL REFERENCES materials(id), revision integer NOT NULL,
 proposal_id uuid NOT NULL UNIQUE REFERENCES material_governance_proposals(id),
 version_id uuid NOT NULL REFERENCES material_versions(id),run_id uuid REFERENCES knowledge_runs(id),
 summary text,actor_id uuid NOT NULL REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(material_id,revision)
);
CREATE FUNCTION scrub_governance_proposals(target uuid) RETURNS void LANGUAGE sql AS $$
 UPDATE material_governance_proposals SET patch=NULL,reason='' WHERE material_id=target;
 UPDATE material_summary_versions SET summary=NULL WHERE material_id=target;
$$;
