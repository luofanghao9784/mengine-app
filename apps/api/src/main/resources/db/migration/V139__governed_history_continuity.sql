-- Preserve historical evidence after data-only replacement, without bypassing current source grants.
CREATE OR REPLACE FUNCTION scene_asset_readable(actor uuid,target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM scene_asset_revisions WHERE target_id=target)
 OR EXISTS(
  SELECT 1 FROM scene_asset_links l JOIN scene_bindings b ON b.tenant_id=l.tenant_id
  JOIN tenant_memberships m ON m.tenant_id=l.tenant_id AND m.account_id=headquarters_permission_actor(actor,l.tenant_id) AND m.status='ACTIVE'
  JOIN accounts a ON a.id=m.account_id AND a.status='ACTIVE'
  WHERE l.active AND b.governance_valid_until>now()
   AND coalesce(l.metadata->'governance'->'allowedActors','[]'::jsonb) ? m.account_id::text
   AND (l.target_id=target OR EXISTS(
    SELECT 1 FROM scene_asset_revisions old
    JOIN business_datasets previous ON previous.id=old.target_id AND previous.tenant_id=old.tenant_id
    JOIN business_datasets current ON current.id=l.target_id AND current.tenant_id=l.tenant_id
    WHERE old.target_id=target AND old.tenant_id=l.tenant_id AND old.kind='TABLE' AND l.kind='TABLE'
     AND NOT previous.scrubbed AND previous.status='WITHDRAWN'
     AND current.status='ACTIVE' AND NOT current.scrubbed
     AND previous.connection_id=current.connection_id AND previous.workspace_id=current.workspace_id
     AND previous.dataset_key=current.dataset_key AND l.source_id=previous.dataset_key
     AND scene_table_scope(old.metadata)=scene_table_scope(l.metadata)
   ))
 )
$$;
