ALTER TABLE workspaces ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD CONSTRAINT archive_shared_only CHECK(NOT archived OR kind='SHARED');
-- Archive is initially restricted to empty spaces; block new content even from late workers.
CREATE FUNCTION guard_archived_workspace_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM workspaces WHERE id=NEW.workspace_id AND archived FOR SHARE) THEN
  RAISE EXCEPTION 'workspace archived';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='workspace_id'
 AND table_name IN(SELECT tablename FROM pg_tables WHERE schemaname='public')
 AND table_name NOT IN('workspace_members','workspace_owner_changes','identity_audit','governance_capabilities') LOOP
 EXECUTE format('CREATE TRIGGER archive_insert_guard BEFORE INSERT OR UPDATE OF workspace_id ON %I FOR EACH ROW EXECUTE FUNCTION guard_archived_workspace_insert()',r.table_name);
 END LOOP;
END $$;
