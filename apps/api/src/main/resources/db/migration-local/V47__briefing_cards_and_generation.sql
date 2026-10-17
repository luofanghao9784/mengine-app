-- Per-delivery preferences. Legacy conversation links remain readable.
CREATE TABLE briefing_card_preferences (
 task_id uuid PRIMARY KEY REFERENCES conversation_tasks(id), tenant_id uuid NOT NULL,
 workspace_id uuid NOT NULL, owner_id uuid NOT NULL, revision integer NOT NULL DEFAULT 1,
 pinned boolean NOT NULL DEFAULT false, hidden boolean NOT NULL DEFAULT false,
 size varchar(16) NOT NULL DEFAULT 'STANDARD' CHECK(size IN ('STANDARD','WIDE')),
 focus_position numeric(30,12), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES tenant_memberships(tenant_id,account_id)
);
INSERT INTO briefing_card_preferences(task_id,tenant_id,workspace_id,owner_id,revision,pinned,hidden,size,focus_position)
 SELECT t.id,p.tenant_id,p.workspace_id,p.owner_id,p.revision,p.pinned,p.hidden,p.size,p.focus_position
 FROM briefing_preferences p JOIN LATERAL (
 SELECT t.id FROM conversation_tasks t WHERE t.conversation_id=p.conversation_id AND t.status='SUCCEEDED'
 AND EXISTS(SELECT 1 FROM conversation_artifacts a JOIN identity_audit proof ON proof.target_id=a.id
 WHERE a.task_id=t.id AND a.attempt_number=t.attempt AND proof.action='TASK_BRIEFING_CREATED' AND proof.outcome='SUCCESS')
 ORDER BY t.finished_at DESC,t.id DESC LIMIT 1) t ON true;
CREATE INDEX briefing_card_focus ON briefing_card_preferences(tenant_id,owner_id,focus_position,task_id);
CREATE FUNCTION maintain_briefing_card_layout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO briefing_layouts(tenant_id,owner_id) VALUES(NEW.tenant_id,NEW.owner_id) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM briefing_layouts WHERE tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id FOR UPDATE;
 IF NEW.pinned AND NEW.focus_position IS NULL THEN
  SELECT coalesce(max(focus_position),0)+1024 INTO NEW.focus_position FROM briefing_card_preferences WHERE tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id;
 END IF;
 UPDATE briefing_layouts SET revision=revision+1,updated_at=now() WHERE tenant_id=NEW.tenant_id AND owner_id=NEW.owner_id;
 RETURN NEW;
END $$;
CREATE TRIGGER maintain_briefing_card_layout BEFORE INSERT OR UPDATE ON briefing_card_preferences FOR EACH ROW EXECUTE FUNCTION maintain_briefing_card_layout();
CREATE TABLE briefing_card_moves (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,owner_id uuid NOT NULL,task_id uuid NOT NULL REFERENCES conversation_tasks(id),
 anchor_id uuid NOT NULL REFERENCES conversation_tasks(id),direction varchar(8) NOT NULL,applied_revision integer NOT NULL,
 FOREIGN KEY(tenant_id,owner_id) REFERENCES tenant_memberships(tenant_id,account_id)
);

-- System policy is separate from a personal delegation. Only in-library, currently authorized sources qualify.
CREATE TABLE briefing_generation_policies (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,owner_id uuid NOT NULL,workspace_id uuid NOT NULL,
 enabled boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1,epoch bigint NOT NULL DEFAULT 1,
 data_key varchar(64),context_key varchar(64),info_day date,checked_at timestamptz,reason varchar(80),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES tenant_memberships(tenant_id,account_id),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id),UNIQUE(tenant_id,owner_id,workspace_id)
);
CREATE TABLE briefing_generation_batches (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,owner_id uuid NOT NULL,workspace_id uuid NOT NULL,
 policy_id uuid NOT NULL REFERENCES briefing_generation_policies(id),policy_epoch bigint NOT NULL,
 trigger_kind varchar(24) NOT NULL,business_type varchar(16),source_key varchar(64),context_key varchar(64),source_versions jsonb NOT NULL DEFAULT '[]',
 scheduled_for timestamptz,status varchar(32) NOT NULL,reason varchar(80),task_id uuid UNIQUE REFERENCES conversation_tasks(id),
 created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz,
 FOREIGN KEY(tenant_id,owner_id) REFERENCES tenant_memberships(tenant_id,account_id),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES workspaces(tenant_id,id)
);
CREATE UNIQUE INDEX briefing_generation_active ON briefing_generation_batches(tenant_id,owner_id,workspace_id,(coalesce(business_type,'AUTO')))
 WHERE status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY');
CREATE INDEX briefing_generation_history ON briefing_generation_batches(tenant_id,owner_id,created_at DESC);
CREATE TABLE briefing_generation_requests (
 tenant_id uuid NOT NULL,owner_id uuid NOT NULL,request_id uuid NOT NULL,fingerprint varchar(64) NOT NULL,
 batch_id uuid NOT NULL REFERENCES briefing_generation_batches(id),PRIMARY KEY(tenant_id,owner_id,request_id)
);
CREATE TABLE briefing_content_keys (
 tenant_id uuid NOT NULL,owner_id uuid NOT NULL,fingerprint varchar(64) NOT NULL,task_id uuid NOT NULL REFERENCES conversation_tasks(id),
 PRIMARY KEY(tenant_id,owner_id,fingerprint)
);
-- A revoked and regranted membership cannot silently revive an old background attempt.
CREATE FUNCTION fence_briefing_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='workspace_members' THEN
  UPDATE briefing_generation_policies SET epoch=epoch+1 WHERE tenant_id=OLD.tenant_id AND owner_id=OLD.account_id AND workspace_id=OLD.workspace_id;
 ELSIF TG_TABLE_NAME='tenant_memberships' THEN
  UPDATE briefing_generation_policies SET epoch=epoch+1 WHERE tenant_id=OLD.tenant_id AND owner_id=OLD.account_id;
 ELSIF TG_TABLE_NAME='tenants' THEN
  UPDATE briefing_generation_policies SET epoch=epoch+1 WHERE tenant_id=OLD.id;
 ELSIF TG_TABLE_NAME='workspaces' THEN
  UPDATE briefing_generation_policies SET epoch=epoch+1 WHERE workspace_id=OLD.id;
 ELSIF TG_TABLE_NAME='accounts' THEN
  UPDATE briefing_generation_policies SET epoch=epoch+1 WHERE owner_id=OLD.id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER fence_briefing_workspace AFTER DELETE OR UPDATE ON workspace_members FOR EACH ROW EXECUTE FUNCTION fence_briefing_generation();
CREATE TRIGGER fence_briefing_membership AFTER DELETE OR UPDATE ON tenant_memberships FOR EACH ROW EXECUTE FUNCTION fence_briefing_generation();
CREATE TRIGGER fence_briefing_account AFTER UPDATE OF status ON accounts FOR EACH ROW EXECUTE FUNCTION fence_briefing_generation();
CREATE TRIGGER fence_briefing_tenant AFTER UPDATE OF status ON tenants FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION fence_briefing_generation();
CREATE TRIGGER fence_briefing_space_owner AFTER UPDATE OF owner_id,kind ON workspaces FOR EACH ROW EXECUTE FUNCTION fence_briefing_generation();
CREATE TABLE briefing_reading_snapshots (
 tenant_id uuid NOT NULL,owner_id uuid NOT NULL,snapshot varchar(64) NOT NULL,scope_key varchar(64) NOT NULL,
 card_ids jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,owner_id,snapshot),FOREIGN KEY(tenant_id,owner_id) REFERENCES tenant_memberships(tenant_id,account_id)
);
