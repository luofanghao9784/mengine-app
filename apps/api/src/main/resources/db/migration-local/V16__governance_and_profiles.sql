-- No owner backfill: existing administrators retain their existing role, never acquire owner duties implicitly.
CREATE TABLE tenant_governance (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 owner_id uuid, revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES tenant_memberships(tenant_id,account_id)
);
CREATE TABLE governance_initial_designations (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 invitation_id uuid NOT NULL,
 designated_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,invitation_id) REFERENCES invitations(tenant_id,id)
);
CREATE TABLE governance_handovers (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 from_account uuid NOT NULL, to_account uuid NOT NULL,
 status varchar(16) NOT NULL CHECK(status IN ('PENDING','ACCEPTED','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz,
 FOREIGN KEY(tenant_id,from_account) REFERENCES tenant_memberships(tenant_id,account_id),
 FOREIGN KEY(tenant_id,to_account) REFERENCES tenant_memberships(tenant_id,account_id),
 CHECK(from_account<>to_account)
);
CREATE UNIQUE INDEX governance_one_pending_handover ON governance_handovers(tenant_id) WHERE status='PENDING';
CREATE TABLE governance_capabilities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL, account_id uuid NOT NULL, workspace_id uuid,
 capability varchar(32) NOT NULL CHECK(capability IN ('PROFILE_MAINTAIN','EXPERIENCE_MAINTAIN','EVALUATION_MAINTAIN','LIFECYCLE_PURGE','BULK_EXPORT','METHOD_ADOPT','PLAN_CONFIGURE','MEMBER_OFFBOARD','TENANT_EXIT')),
 granted_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE NULLS NOT DISTINCT(tenant_id,account_id,workspace_id,capability),
 FOREIGN KEY(tenant_id,account_id) REFERENCES tenant_memberships(tenant_id,account_id),
 FOREIGN KEY(tenant_id,workspace_id,account_id) REFERENCES workspace_members(tenant_id,workspace_id,account_id) ON DELETE CASCADE
);
CREATE TABLE governance_recovery_requests (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), requested_by uuid NOT NULL REFERENCES accounts(id),
 reason varchar(32) NOT NULL CHECK(reason IN ('OWNER_UNAVAILABLE','LEGACY_OWNER_UNVERIFIED')),
 status varchar(24) NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK(status='PENDING_VERIFICATION'),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE governance_security_stops (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, account_id uuid NOT NULL,
 requested_by uuid NOT NULL REFERENCES accounts(id), member_version bigint NOT NULL CHECK(member_version>=0),
 security_action varchar(32) NOT NULL CHECK(security_action='SECURITY_RISK'), recovery_request_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,account_id) REFERENCES tenant_memberships(tenant_id,account_id),
 FOREIGN KEY(tenant_id,recovery_request_id) REFERENCES governance_recovery_requests(tenant_id,id)
);
CREATE TABLE profile_entries (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), scope varchar(12) NOT NULL CHECK(scope IN ('TENANT','WORKSPACE','PERSONAL')),
 workspace_id uuid, account_id uuid, entry_key varchar(100) NOT NULL,
 kind varchar(16) NOT NULL CHECK(kind IN ('FACT','INFERENCE','GOAL','PREFERENCE')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE NULLS NOT DISTINCT(tenant_id,scope,workspace_id,account_id,entry_key),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),
 FOREIGN KEY(tenant_id,account_id) REFERENCES tenant_memberships(tenant_id,account_id),
 CHECK((scope='TENANT' AND workspace_id IS NULL AND account_id IS NULL) OR (scope='WORKSPACE' AND workspace_id IS NOT NULL AND account_id IS NULL) OR (scope='PERSONAL' AND workspace_id IS NULL AND account_id IS NOT NULL))
);
CREATE TABLE profile_versions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, entry_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 value text NOT NULL CHECK(length(value)<=4000), provenance varchar(500) NOT NULL,
 status varchar(12) NOT NULL CHECK(status IN ('ACTIVE','PROPOSED','WITHDRAWN')),
 expires_at timestamptz, changed_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entry_id) REFERENCES profile_entries(tenant_id,id), UNIQUE(entry_id,revision)
);
