CREATE TABLE dataset_knowledge_publications (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 dataset_id uuid NOT NULL REFERENCES business_datasets(id),
 release_id uuid NOT NULL REFERENCES native_governance_releases(id),
 source_snapshot_id uuid NOT NULL REFERENCES dataset_snapshots(id),
 document jsonb NOT NULL,
 content_hash text NOT NULL,
 state text NOT NULL CHECK (state IN ('DRAFT','PUBLISHED','STALE')),
 reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 UNIQUE(tenant_id,dataset_id,release_id)
);
CREATE INDEX dataset_knowledge_current ON dataset_knowledge_publications(tenant_id,dataset_id,state);
