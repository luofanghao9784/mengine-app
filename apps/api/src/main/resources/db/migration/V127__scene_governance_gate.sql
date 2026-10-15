-- Source policy is an additional restriction; target workspace/library permissions still apply.
ALTER TABLE scene_bindings ADD COLUMN governance_valid_until timestamptz;
CREATE FUNCTION scene_asset_readable(actor uuid,target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM scene_asset_revisions WHERE target_id=target)
 OR EXISTS(
  SELECT 1 FROM scene_asset_links l JOIN scene_bindings b ON b.tenant_id=l.tenant_id
  JOIN tenant_memberships m ON m.tenant_id=l.tenant_id AND m.account_id=headquarters_permission_actor(actor,l.tenant_id) AND m.status='ACTIVE'
  JOIN accounts a ON a.id=m.account_id AND a.status='ACTIVE'
  WHERE l.target_id=target AND l.active AND b.governance_valid_until>now()
   AND coalesce(l.metadata->'governance'->'allowedActors','[]'::jsonb) ? m.account_id::text
 )
$$;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('file_dataset_readable(uuid,uuid)'::regprocedure) INTO definition;
 EXECUTE replace(definition,'FUNCTION public.file_dataset_readable(', 'FUNCTION public.file_dataset_readable_before_scene(');
 SELECT pg_get_functiondef('library_mask(uuid,uuid,text,uuid)'::regprocedure) INTO definition;
 EXECUTE replace(definition,'FUNCTION public.library_mask(', 'FUNCTION public.library_mask_before_scene(');
 SELECT pg_get_functiondef('library_file_mask(uuid,uuid,uuid,uuid[],text,uuid,uuid,boolean)'::regprocedure) INTO definition;
 EXECUTE replace(definition,'FUNCTION public.library_file_mask(', 'FUNCTION public.library_file_mask_before_scene(');
END $$;
CREATE OR REPLACE FUNCTION library_file_mask(actor uuid,tenant uuid,target uuid,visited uuid[] DEFAULT ARRAY[]::uuid[],moving_kind text DEFAULT NULL,moving_id uuid DEFAULT NULL,destination uuid DEFAULT NULL,force_inherit boolean DEFAULT false) RETURNS integer LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN NOT scene_asset_readable(actor,target) THEN 0 ELSE library_file_mask_before_scene(actor,tenant,target,visited,moving_kind,moving_id,destination,force_inherit) END
$$;
CREATE OR REPLACE FUNCTION file_dataset_readable(actor uuid,target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT file_dataset_readable_before_scene(actor,target) AND scene_asset_readable(actor,target)
$$;
CREATE OR REPLACE FUNCTION library_mask(actor uuid,tenant uuid,kind text,target uuid) RETURNS integer LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN kind='MATERIAL' AND NOT scene_asset_readable(actor,target) THEN 0
 ELSE library_mask_before_scene(actor,tenant,kind,target) END
$$;
