BEGIN;
SET LOCAL statement_timeout='180s';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE wipe_rows(rel oid,pos tid,PRIMARY KEY(rel,pos)) ON COMMIT DROP;
CREATE TEMP TABLE reset_roots(name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO reset_roots SELECT unnest(ARRAY['agent_attempt_usage','briefing_bootstrap_receipts','briefing_content_keys','briefing_generation_batches','briefing_generation_requests','briefing_reading_snapshots','business_datasets','collection_runs','conversation_artifacts','conversation_events','conversation_tasks','conversation_titles','conversations','delivery_observations','engine_execution_receipts','experience_analysis_items','experience_analysis_runs','experience_intake_sources','identity_audit','knowledge_chunks','knowledge_runs','library_events','library_request_journal','material_versions','materials','metric_generation_keys','object_lifecycle','ongoing_plan_material_events','operation_retention_windows','platform_engine_retries','recommendation_presentations','scene_asset_links','scene_asset_revisions','scene_metric_events','scene_metrics','scene_processing_runs']);
CREATE TEMP TABLE protected_tables(name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO protected_tables SELECT unnest(ARRAY['tenants','accounts','tenant_memberships','tenant_governance','platform_accounts','platform_roles','platform_initialization','platform_sessions','spring_session','spring_session_attributes','workspaces','workspace_members','library_departments','library_department_members','library_permission_rollouts','library_policies','library_grants','material_folders','scene_bindings','data_connections','metric_generation_settings','briefing_generation_policies','briefing_daily_schedules','governance_capabilities','invitations','tenant_initial_admin']);
DO $$ DECLARE r record; n bigint; added bigint; clause text; bad boolean; BEGIN
 FOR r IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace JOIN reset_roots x ON x.name=c.relname WHERE ns.nspname='public' AND c.relkind='r' LOOP
  EXECUTE format('INSERT INTO wipe_rows SELECT %s,ctid FROM %I WHERE tenant_id=%L',r.oid,r.relname,'951228cb-58d8-474f-b784-55f5b946e81a');
 END LOOP;
 LOOP
  added=0;
  FOR r IN SELECT c.*,p.relname parent,ch.relname child FROM pg_constraint c JOIN pg_class p ON p.oid=c.confrelid JOIN pg_class ch ON ch.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=ch.relnamespace WHERE c.contype='f' AND ns.nspname='public' AND EXISTS(SELECT 1 FROM wipe_rows w WHERE w.rel=c.confrelid) LOOP
   SELECT string_agg(format('ch.%I=p.%I',a.attname,b.attname),' AND ') INTO clause FROM unnest(r.conkey,r.confkey) k(ak,bk) JOIN pg_attribute a ON a.attrelid=r.conrelid AND a.attnum=k.ak JOIN pg_attribute b ON b.attrelid=r.confrelid AND b.attnum=k.bk;
   EXECUTE format('INSERT INTO wipe_rows SELECT %s,ch.ctid FROM %I ch JOIN %I p ON %s JOIN wipe_rows w ON w.rel=%s AND w.pos=p.ctid ON CONFLICT DO NOTHING',r.conrelid,r.child,r.parent,clause,r.confrelid);
   GET DIAGNOSTICS n=ROW_COUNT;added=added+n;
  END LOOP;
  EXIT WHEN added=0;
 END LOOP;
 IF EXISTS(SELECT 1 FROM wipe_rows w JOIN pg_class c ON c.oid=w.rel JOIN protected_tables p ON p.name=c.relname) THEN RAISE EXCEPTION 'Reset intersects retained identity, permission or configuration rows';END IF;
 FOR r IN SELECT DISTINCT w.rel,c.relname FROM wipe_rows w JOIN pg_class c ON c.oid=w.rel WHERE EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=w.rel AND a.attname='tenant_id') LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I t JOIN wipe_rows w ON w.rel=%s AND w.pos=t.ctid WHERE t.tenant_id IS DISTINCT FROM %L::uuid)',r.relname,r.rel,'951228cb-58d8-474f-b784-55f5b946e81a') INTO bad;
  IF bad THEN RAISE EXCEPTION 'Cross-tenant dependency in %',r.relname;END IF;
 END LOOP;
END $$;
SELECT c.relname,count(*) FROM wipe_rows w JOIN pg_class c ON c.oid=w.rel GROUP BY c.relname ORDER BY c.relname;
-- EXECUTION_POINT: reviewed scoped deletes are added only for the stopped-service cutover.
ROLLBACK;
