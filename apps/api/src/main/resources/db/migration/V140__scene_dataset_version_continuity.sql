-- A data refresh changes the immutable snapshot, not the source's authorization identity.
-- Retain every scope/schema/recipe field, including each upstream source's policy version.
CREATE FUNCTION scene_table_scope(meta jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT (meta - 'version' - 'updatedAt' - 'sourceBasis') ||
  CASE WHEN meta ? 'sourceBasis' THEN jsonb_build_object('sourceBasis',
   (SELECT coalesce(jsonb_agg(item - 'version' - 'sha256' - 'collectedAt' ORDER BY item->>'id'),'[]'::jsonb)
    FROM jsonb_array_elements(meta->'sourceBasis') item)) ELSE '{}'::jsonb END
$$;

-- Old deployments assigned a different dataset ID on every data version. Only bridge-owned
-- predecessors with identical scope may resolve to the currently exported source.
CREATE FUNCTION scene_dataset_available(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM business_datasets d WHERE d.id=target AND NOT d.scrubbed AND
  (d.status='ACTIVE' OR (d.status='WITHDRAWN' AND EXISTS(
   SELECT 1 FROM scene_asset_revisions old
   JOIN scene_asset_links link ON link.tenant_id=old.tenant_id AND link.kind='TABLE' AND link.active
   JOIN business_datasets current ON current.id=link.target_id
   WHERE old.target_id=d.id AND old.tenant_id=d.tenant_id AND old.kind='TABLE'
    AND link.source_id=d.dataset_key AND current.tenant_id=d.tenant_id
    AND current.connection_id=d.connection_id AND current.workspace_id=d.workspace_id
    AND current.dataset_key=d.dataset_key AND current.status='ACTIVE' AND NOT current.scrubbed
    AND scene_table_scope(old.metadata)=scene_table_scope(link.metadata)
  ))))
$$;

-- Preserve all existing tenant, snapshot, membership and file-source checks.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('task_datasets_readable_before_files(uuid)'::regprocedure) INTO definition;
 IF position('d.status <> ''ACTIVE''::text' in definition)>0 THEN
  definition:=replace(definition,'d.status <> ''ACTIVE''::text','NOT scene_dataset_available(d.id)');
 ELSIF position('d.status<>''ACTIVE''' in definition)>0 THEN
  definition:=replace(definition,'d.status<>''ACTIVE''','NOT scene_dataset_available(d.id)');
 ELSE RAISE EXCEPTION 'Unexpected dataset permission function'; END IF;
 EXECUTE definition;
END $$;
