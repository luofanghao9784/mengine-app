ALTER TABLE conversations ADD CONSTRAINT conversation_owner_scope UNIQUE(tenant_id,workspace_id,id,owner_id);
CREATE TABLE briefing_preferences (
 tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, conversation_id uuid NOT NULL, owner_id uuid NOT NULL,
 pinned boolean NOT NULL DEFAULT false, hidden boolean NOT NULL DEFAULT false,
 size varchar(12) NOT NULL DEFAULT 'STANDARD' CHECK(size IN ('STANDARD','WIDE')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(conversation_id),
 FOREIGN KEY(tenant_id,workspace_id,conversation_id,owner_id) REFERENCES conversations(tenant_id,workspace_id,id,owner_id)
);
CREATE INDEX briefing_success_time ON conversation_tasks(conversation_id,finished_at DESC,id DESC) WHERE status='SUCCEEDED' AND mode='AGENT';
