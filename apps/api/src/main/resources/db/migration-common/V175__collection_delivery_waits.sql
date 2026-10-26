CREATE TABLE collection_delivery_waits (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 dataset_id uuid NOT NULL REFERENCES business_datasets(id),
 run_id uuid NOT NULL REFERENCES collection_runs(id),
 reason text NOT NULL CHECK(reason IN ('WAITING_SOURCE_DEFINITION','SOURCE_DATA_REQUIRES_REVIEW','SOURCE_COLLECTION_PENDING')),
 checked_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,dataset_id)
);

-- Deterministic provenance, separate from paid model jobs.
CREATE TABLE source_contract_publications (
 release_id uuid PRIMARY KEY REFERENCES native_governance_releases(id),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 dataset_id uuid NOT NULL REFERENCES business_datasets(id)
);
