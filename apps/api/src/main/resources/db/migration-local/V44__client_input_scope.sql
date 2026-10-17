-- A private attachment uses the owner's personal workspace; library listing is an explicit promotion.
ALTER TABLE materials ADD COLUMN in_library boolean NOT NULL DEFAULT true;
ALTER TABLE materials ADD COLUMN attachment_conversation_id uuid REFERENCES conversations(id);
CREATE INDEX material_attachment_conversation ON materials(attachment_conversation_id) WHERE attachment_conversation_id IS NOT NULL;
ALTER TABLE conversation_tasks ADD COLUMN source_scope varchar(24) NOT NULL DEFAULT 'WORKSPACE' CHECK(source_scope IN ('WORKSPACE','AUTHORIZED_LIBRARY','SELECTED'));
ALTER TABLE conversation_tasks ADD CONSTRAINT task_tenant_identity UNIQUE(tenant_id,id);
ALTER TABLE knowledge_chunks ADD CONSTRAINT chunk_tenant_identity UNIQUE(tenant_id,id);
-- Source workspace and work workspace are independent. Both sides retain tenant foreign keys.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conrelid::regclass AS tbl,conname FROM pg_constraint WHERE contype='f'
 AND confrelid='conversation_tasks'::regclass AND conrelid IN ('conversation_originals'::regclass,'conversation_task_material_versions'::regclass)
 LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.tbl,c.conname); END LOOP;
 FOR c IN SELECT conrelid::regclass AS tbl,conname FROM pg_constraint WHERE contype='f'
 AND confrelid='knowledge_chunks'::regclass AND conrelid IN ('conversation_sources'::regclass,'conversation_agent_grants'::regclass)
 LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.tbl,c.conname); END LOOP;
END $$;
ALTER TABLE conversation_originals ADD FOREIGN KEY(tenant_id,task_id) REFERENCES conversation_tasks(tenant_id,id);
ALTER TABLE conversation_task_material_versions ADD FOREIGN KEY(tenant_id,task_id) REFERENCES conversation_tasks(tenant_id,id);
ALTER TABLE conversation_sources ADD FOREIGN KEY(tenant_id,chunk_id) REFERENCES knowledge_chunks(tenant_id,id);
ALTER TABLE conversation_agent_grants ADD FOREIGN KEY(tenant_id,chunk_id) REFERENCES knowledge_chunks(tenant_id,id);

CREATE OR REPLACE VIEW active_materials AS
 SELECT m.* FROM materials m WHERE NOT EXISTS
  (SELECT 1 FROM content_lifecycle l WHERE l.object_kind='MATERIAL' AND l.object_id=m.id AND l.state<>'ACTIVE')
 AND (m.folder_id IS NULL OR EXISTS(SELECT 1 FROM active_material_folders f WHERE f.id=m.folder_id));
