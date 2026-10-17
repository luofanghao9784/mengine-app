-- Activity is a permission-filtered projection of committed versions, not a second event store.
CREATE INDEX material_activity_order ON material_versions(tenant_id,created_at DESC,id DESC);
