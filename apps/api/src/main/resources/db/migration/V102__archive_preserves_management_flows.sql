-- Archive blocks new business roots, not exit/export/lifecycle/audit metadata.
-- Keep maintenance and formal departure usable for archived empty workspaces.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE t.tgname='archive_insert_guard' AND n.nspname='public'
 AND c.relname NOT IN('material_folders','materials','conversations','conversation_tasks','private_documents','experience_entries','feedback_entries','evaluation_assets','evaluation_runs','profile_entries','business_datasets','ongoing_plans','briefing_generation_policies','briefing_daily_schedules') LOOP
 EXECUTE format('DROP TRIGGER archive_insert_guard ON %I',r.relname);
 END LOOP;
END $$;
