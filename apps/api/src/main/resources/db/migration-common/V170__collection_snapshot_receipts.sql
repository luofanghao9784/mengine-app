-- Exact exported contents and source timestamps; contains no business rows or credentials.
CREATE TABLE collection_snapshot_receipts (
 snapshot_id uuid PRIMARY KEY REFERENCES dataset_snapshots(id),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 dataset_id uuid NOT NULL REFERENCES business_datasets(id),
 receipt jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collection_snapshot_receipts_dataset ON collection_snapshot_receipts(tenant_id,dataset_id);
