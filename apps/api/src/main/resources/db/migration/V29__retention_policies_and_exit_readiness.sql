-- These are preparation records, not evidence that access was disabled or data was deleted.
-- Existing content deadlines are deliberately not backfilled or shortened.
CREATE TABLE retention_policy_versions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), policy_key varchar(40) NOT NULL,
 revision integer NOT NULL CHECK(revision>0), days integer NOT NULL CHECK(days BETWEEN 1 AND 3650),
 reason varchar(500) NOT NULL, changed_by uuid NOT NULL REFERENCES accounts(id), effective_at timestamptz NOT NULL,
 UNIQUE(tenant_id,policy_key,revision)
);
CREATE INDEX retention_policy_latest ON retention_policy_versions(tenant_id,policy_key,revision DESC);
CREATE TABLE retention_cases (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), kind varchar(24) NOT NULL CHECK(kind IN('MEMBER_OFFBOARD','TENANT_EXIT')),
 target_account_id uuid REFERENCES accounts(id), label varchar(100) NOT NULL,
 state varchar(16) NOT NULL CHECK(state IN('DRAFT','ASSESSED','CANCELLED')), revision integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL, changed_at timestamptz NOT NULL,
 CHECK((kind='MEMBER_OFFBOARD' AND target_account_id IS NOT NULL) OR (kind='TENANT_EXIT' AND target_account_id IS NULL))
);
CREATE INDEX retention_case_page ON retention_cases(tenant_id,created_at DESC,id);
CREATE TABLE retention_case_scopes (
 case_id uuid NOT NULL REFERENCES retention_cases(id), tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
 PRIMARY KEY(case_id,workspace_id), FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
CREATE TABLE retention_case_versions (
 case_id uuid NOT NULL REFERENCES retention_cases(id), revision integer NOT NULL,
 state varchar(16) NOT NULL CHECK(state IN('DRAFT','ASSESSED','CANCELLED')), action varchar(16) NOT NULL,
 checklist jsonb NOT NULL, assessment jsonb, changed_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL,
 PRIMARY KEY(case_id,revision)
);
-- No automatic deletion worker, account reactivation, exit activation or tenant status mutation in V29.
-- Later execution migrations must retain these preparation facts and add separate effective execution receipts.
