-- Version-bound structured admission. Originals and permissions remain owned by the library.
CREATE TABLE file_table_sources (
 version_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, material_id uuid NOT NULL,
 run_id uuid NOT NULL REFERENCES knowledge_runs(id), dataset_id uuid UNIQUE REFERENCES business_datasets(id),
 state varchar(24) NOT NULL CHECK(state IN('READY','DOCUMENT_ONLY')), reason varchar(80) NOT NULL,
 checked_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id,material_id,version_id) REFERENCES material_versions(tenant_id,workspace_id,material_id,id)
);
CREATE INDEX file_table_material ON file_table_sources(tenant_id,material_id);
CREATE FUNCTION file_dataset_current(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM file_table_sources f WHERE f.dataset_id=target) OR EXISTS(
  SELECT 1 FROM file_table_sources f JOIN material_versions v ON v.id=f.version_id
  JOIN active_materials m ON m.id=f.material_id AND m.tenant_id=f.tenant_id AND m.workspace_id=f.workspace_id AND m.current_version=v.number
  JOIN workspaces w ON w.id=m.workspace_id AND w.tenant_id=m.tenant_id AND w.kind='SHARED' AND NOT w.archived
  JOIN knowledge_runs k ON k.id=f.run_id
  WHERE f.dataset_id=target AND f.state='READY' AND m.in_library AND object_is_active('MATERIAL',m.id)
   AND k.status IN('READY','PARTIAL') AND k.generation=(SELECT max(generation) FROM knowledge_runs WHERE version_id=v.id)
 )
$$;
CREATE FUNCTION file_dataset_readable(actor uuid,target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT file_dataset_current(target) AND NOT EXISTS(
  SELECT 1 FROM file_table_sources f WHERE f.dataset_id=target
   AND (library_mask(headquarters_permission_actor(actor,f.tenant_id),f.tenant_id,'MATERIAL',f.material_id)&1)=0
 )
$$;
-- Existing consumers keep their original gate, plus the source-file gate. Preserve function OID.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('task_datasets_readable(uuid)'::regprocedure) INTO definition;
 EXECUTE replace(definition,'FUNCTION public.task_datasets_readable(', 'FUNCTION public.task_datasets_readable_before_files(');
END $$;
CREATE OR REPLACE FUNCTION task_datasets_readable(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT task_datasets_readable_before_files(target) AND NOT EXISTS(
  SELECT 1 FROM task_dataset_sources(target) ref JOIN dataset_snapshots s ON s.id=ref.snapshot_id
  JOIN conversation_tasks t ON t.id=target WHERE NOT file_dataset_readable(t.requested_by,s.dataset_id)
 )
$$;
-- Erasing a source file must also erase its structured copies and derived task content.
CREATE FUNCTION scrub_file_tables(material uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 UPDATE dataset_snapshots SET data_rows='[]'::jsonb,scrubbed=true
  WHERE NOT scrubbed AND dataset_id IN(SELECT dataset_id FROM file_table_sources WHERE material_id=material);
 UPDATE business_datasets SET name='内容已按退出期限清理',description='',dataset_key='removed-'||id::text,
  column_names='["已清理"]'::jsonb,status='WITHDRAWN',scrubbed=true
  WHERE NOT scrubbed AND id IN(SELECT dataset_id FROM file_table_sources WHERE material_id=material);
 UPDATE data_connections SET name='内容已按退出期限清理',route_label='',access_summary='',status='UNCONFIGURED',auto_enabled=false,next_due=NULL
  WHERE id IN(SELECT d.connection_id FROM business_datasets d JOIN file_table_sources f ON f.dataset_id=d.id WHERE f.material_id=material);
END $$;
