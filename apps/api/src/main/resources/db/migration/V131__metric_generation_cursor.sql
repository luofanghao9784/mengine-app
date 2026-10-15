ALTER TABLE metric_generation_settings ADD COLUMN definition_cursor uuid;
CREATE INDEX scene_metrics_catalog_page ON scene_metrics(tenant_id,updated_at DESC,id);
