CREATE TABLE accounts (
    id uuid PRIMARY KEY,
    email varchar(254) NOT NULL UNIQUE CHECK (email = lower(trim(email))),
    display_name varchar(80) NOT NULL,
    password_hash text NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_roles (
    account_id uuid NOT NULL REFERENCES accounts(id),
    role varchar(32) NOT NULL CHECK (role = 'PLATFORM_ADMIN'),
    PRIMARY KEY (account_id, role)
);
CREATE TABLE tenants (
    id uuid PRIMARY KEY,
    name varchar(100) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant_memberships (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    account_id uuid NOT NULL REFERENCES accounts(id),
    role varchar(24) NOT NULL CHECK (role IN ('TENANT_ADMIN','MEMBER')),
    status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
    PRIMARY KEY (tenant_id, account_id)
);
CREATE TABLE workspaces (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    owner_id uuid NOT NULL,
    name varchar(100) NOT NULL,
    kind varchar(16) NOT NULL CHECK (kind IN ('PERSONAL','SHARED')),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, owner_id) REFERENCES tenant_memberships(tenant_id, account_id)
);
CREATE UNIQUE INDEX personal_workspace_per_member ON workspaces(tenant_id, owner_id) WHERE kind = 'PERSONAL';
CREATE TABLE workspace_members (
    tenant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    account_id uuid NOT NULL,
    PRIMARY KEY (tenant_id, workspace_id, account_id),
    FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces(tenant_id, id),
    FOREIGN KEY (tenant_id, account_id) REFERENCES tenant_memberships(tenant_id, account_id)
);
CREATE TABLE invitations (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    email varchar(254) NOT NULL CHECK (email = lower(trim(email))),
    role varchar(24) NOT NULL CHECK (role IN ('TENANT_ADMIN','MEMBER')),
    token_hash varchar(64) NOT NULL UNIQUE,
    status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
    expires_at timestamptz NOT NULL,
    created_by uuid NOT NULL REFERENCES accounts(id),
    accepted_by uuid REFERENCES accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'ACCEPTED') = (accepted_by IS NOT NULL))
);
CREATE UNIQUE INDEX one_pending_invitation ON invitations(tenant_id, email) WHERE status = 'PENDING';
CREATE TABLE identity_requests (
    actor_id uuid NOT NULL REFERENCES accounts(id),
    request_id uuid NOT NULL,
    operation varchar(32) NOT NULL,
    fingerprint varchar(64) NOT NULL,
    target_id uuid NOT NULL,
    PRIMARY KEY (actor_id, request_id)
);
CREATE TABLE identity_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id uuid REFERENCES accounts(id),
    tenant_id uuid REFERENCES tenants(id),
    action varchar(40) NOT NULL,
    target_id uuid,
    outcome varchar(16) NOT NULL CHECK (outcome IN ('SUCCESS','DENIED','FAILURE')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_audit_tenant_time ON identity_audit(tenant_id, created_at);
CREATE TABLE login_attempts (
    bucket varchar(64) PRIMARY KEY,
    window_start timestamptz NOT NULL,
    attempts integer NOT NULL
);
