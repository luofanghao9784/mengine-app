CREATE TABLE business_sources (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
 name varchar(160) NOT NULL, description varchar(2000) NOT NULL,
 responsible_id uuid NOT NULL, cadence_hours integer CHECK(cadence_hours BETWEEN 1 AND 8760),
 expected_from date, expected_through date,
 status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED')),
 revision integer NOT NULL DEFAULT 0, created_by uuid NOT NULL REFERENCES accounts(id),
 due_anchor_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,workspace_id,id),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),
 FOREIGN KEY(tenant_id,responsible_id) REFERENCES tenant_memberships(tenant_id,account_id),
 CHECK((expected_from IS NULL AND expected_through IS NULL) OR
       (expected_from IS NOT NULL AND expected_through IS NOT NULL AND expected_from<=expected_through))
);
CREATE TABLE business_source_config_versions (
 source_id uuid NOT NULL REFERENCES business_sources(id), revision integer NOT NULL,
 settings jsonb NOT NULL, changed_by uuid NOT NULL REFERENCES accounts(id),
 effective_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(source_id,revision)
);
CREATE TABLE business_source_submissions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, source_id uuid NOT NULL,
 coverage_from date NOT NULL, coverage_through date NOT NULL, note varchar(2000) NOT NULL,
 status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','WITHDRAWN')),
 revision integer NOT NULL DEFAULT 0, submitted_by uuid NOT NULL REFERENCES accounts(id),
 submitted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,workspace_id,source_id,id),
 FOREIGN KEY(tenant_id,workspace_id,source_id) REFERENCES business_sources(tenant_id,workspace_id,id),
 CHECK(coverage_from<=coverage_through)
);
CREATE TABLE business_source_versions (
 submission_id uuid NOT NULL REFERENCES business_source_submissions(id),
 version_id uuid NOT NULL REFERENCES material_versions(id),
 PRIMARY KEY(submission_id,version_id)
);
CREATE INDEX business_source_scope ON business_sources(tenant_id,workspace_id,updated_at DESC,id);
CREATE INDEX business_source_history ON business_source_submissions(source_id,submitted_at DESC,id);
