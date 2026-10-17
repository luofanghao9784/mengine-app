-- Capture policy decisions for new lifecycle actions/packages; never backfill old deadlines.
ALTER TABLE content_lifecycle ADD COLUMN retention_policy_revision integer;
ALTER TABLE content_lifecycle ADD CONSTRAINT lifecycle_policy_revision_nonnegative CHECK (retention_policy_revision IS NULL OR retention_policy_revision >= 0);
ALTER TABLE export_batches ADD COLUMN retention_policy_revision integer;
ALTER TABLE export_batches ADD COLUMN retention_anchor timestamptz;
ALTER TABLE export_batches ADD COLUMN retention_deadline timestamptz;
ALTER TABLE export_batches ADD CONSTRAINT export_policy_revision_nonnegative CHECK (retention_policy_revision IS NULL OR retention_policy_revision >= 0);
ALTER TABLE export_batches ADD CONSTRAINT export_retention_fixed_pair CHECK ((retention_anchor IS NULL) = (retention_deadline IS NULL));
