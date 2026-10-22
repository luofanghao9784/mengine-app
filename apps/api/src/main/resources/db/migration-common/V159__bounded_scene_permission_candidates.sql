-- Preserve V154 permission semantics. Resolve the target/lineage before expanding
-- JSON scope or actor checks: large scene metadata must not be compared to every source.
CREATE INDEX scene_links_active_target ON scene_asset_links(target_id) WHERE active;
CREATE INDEX scene_revisions_target ON scene_asset_revisions(target_id);

CREATE OR REPLACE FUNCTION scene_asset_readable(actor uuid,target uuid) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM scene_asset_revisions WHERE target_id=target) THEN
  RETURN true;
 END IF;
 RETURN EXISTS(
  WITH candidates AS MATERIALIZED (
   SELECT l.tenant_id,l.metadata,NULL::jsonb AS old_metadata,true AS direct
   FROM scene_asset_links l WHERE l.target_id=target AND l.active
   UNION ALL
   SELECT l.tenant_id,l.metadata,old.metadata,false
   FROM scene_asset_revisions old
   JOIN business_datasets previous ON previous.id=old.target_id AND previous.tenant_id=old.tenant_id
   JOIN scene_asset_links l ON l.tenant_id=old.tenant_id AND l.source_id=previous.dataset_key
    AND l.kind='TABLE' AND l.active
   JOIN business_datasets current ON current.id=l.target_id AND current.tenant_id=l.tenant_id
   WHERE old.target_id=target AND old.kind='TABLE'
    AND NOT previous.scrubbed AND previous.status='WITHDRAWN'
    AND current.status='ACTIVE' AND NOT current.scrubbed
    AND previous.connection_id=current.connection_id AND previous.workspace_id=current.workspace_id
    AND previous.dataset_key=current.dataset_key
  )
  SELECT 1 FROM candidates l JOIN scene_bindings b ON b.tenant_id=l.tenant_id
  JOIN tenant_memberships m ON m.tenant_id=l.tenant_id
   AND m.account_id=headquarters_permission_actor(actor,l.tenant_id) AND m.status='ACTIVE'
  JOIN accounts a ON a.id=m.account_id AND a.status='ACTIVE'
  WHERE b.governance_valid_until>now()
   AND coalesce(l.metadata->'governance'->'allowedActors','[]'::jsonb) ? m.account_id::text
   AND (NOT (l.metadata ? 'routing') OR coalesce(l.metadata->'routing'->'readers','[]'::jsonb) ? m.account_id::text)
   AND (l.direct OR scene_table_scope(l.old_metadata)=scene_table_scope(l.metadata))
 );
END
$$;
