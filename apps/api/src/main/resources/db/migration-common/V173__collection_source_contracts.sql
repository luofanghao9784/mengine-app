-- Immutable metadata for the rules delivered with an accepted snapshot; never contains raw rows.
ALTER TABLE collection_snapshot_receipts ADD COLUMN source_contract jsonb;
