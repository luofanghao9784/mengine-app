CREATE TABLE method_families (
 id uuid PRIMARY KEY,kind varchar(20) NOT NULL CHECK(kind='RANKING_V1'),title varchar(180) NOT NULL,
 revision integer NOT NULL DEFAULT 1,head_version uuid,published_version uuid,created_by uuid NOT NULL REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE method_versions (
 id uuid PRIMARY KEY,family_id uuid NOT NULL REFERENCES method_families(id),number integer NOT NULL,
 base_version uuid REFERENCES method_versions(id),configuration jsonb NOT NULL,configuration_sha varchar(64) NOT NULL,
 compatibility varchar(32) NOT NULL CHECK(compatibility='ranking-v1'),rationale varchar(2000) NOT NULL,
 created_by uuid NOT NULL REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(family_id,number),UNIQUE(family_id,id)
);
ALTER TABLE method_families ADD CONSTRAINT method_family_head FOREIGN KEY(id,head_version) REFERENCES method_versions(family_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE method_families ADD CONSTRAINT method_family_published FOREIGN KEY(id,published_version) REFERENCES method_versions(family_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE method_comparisons (
 id uuid PRIMARY KEY,candidate_version uuid NOT NULL REFERENCES method_versions(id),baseline_version uuid REFERENCES method_versions(id),
 standard_version uuid NOT NULL REFERENCES evaluation_asset_versions(id),sample_versions jsonb NOT NULL,
 results jsonb NOT NULL,created_by uuid NOT NULL REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE method_releases (
 version_id uuid PRIMARY KEY REFERENCES method_versions(id),comparison_id uuid NOT NULL REFERENCES method_comparisons(id),
 actor_id uuid NOT NULL REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE method_adoptions (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),workspace_id uuid,
 revision integer NOT NULL DEFAULT 1,status varchar(12) NOT NULL CHECK(status IN ('ACTIVE','STOPPED')),
 version_id uuid NOT NULL REFERENCES method_releases(version_id),actor_id uuid NOT NULL REFERENCES accounts(id),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),UNIQUE NULLS NOT DISTINCT(tenant_id,workspace_id)
);
CREATE TABLE method_adoption_events (
 id uuid PRIMARY KEY,adoption_id uuid NOT NULL REFERENCES method_adoptions(id),revision integer NOT NULL,
 action varchar(12) NOT NULL CHECK(action IN ('ADOPT','STOP','ROLLBACK')),version_id uuid NOT NULL REFERENCES method_releases(version_id),
 actor_id uuid NOT NULL REFERENCES accounts(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(adoption_id,revision)
);
